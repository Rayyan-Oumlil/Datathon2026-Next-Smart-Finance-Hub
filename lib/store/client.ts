import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { memoryBackend } from './memory';

export type Item = Record<string, unknown>;

export type QueryInput = {
    table: string;
    index?: string;                    // a secondary index name; omit for the table itself
    keyName: string;                   // partition key of the table or index
    keyValue: string;
    filter?: Record<string, string>;   // equality on non-key attributes
};

/** The operations the stores need. There is deliberately no update and no delete. */
export interface Backend {
    get(table: string, key: Item): Promise<Item | undefined>;
    /** Overwrites. Only the profile table accepts this; any other table throws. */
    put(table: string, item: Item): Promise<void>;
    /**
     * Overwrites only when the stored row's `version` is `expected` (0: no row with this key yet), for the mutable
     * documents kept in the profile table (session record, app state). Throws VersionConflictError otherwise.
     * The item carries its new version. Only the profile table accepts this; any other table throws.
     */
    putIfVersion(table: string, item: Item, expected: number): Promise<void>;
    /** Writes only when no row has this key; otherwise throws AlreadyExistsError. */
    putNew(table: string, item: Item): Promise<void>;
    /** Every matching row, oldest first (by id). */
    query(input: QueryInput): Promise<Item[]>;
}

export class AlreadyExistsError extends Error {
    constructor(table: string, id: unknown) {
        super(`${table}: a row with id ${String(id)} already exists; the log is append-only`);
        this.name = 'AlreadyExistsError';
    }
}

export class VersionConflictError extends Error {
    constructor(table: string, key: unknown) {
        super(`${table}: ${String(key)} changed since it was read`);
        this.name = 'VersionConflictError';
    }
}

export const tables = {
    profile: () => process.env.PROFILE_TABLE || 'profile_config',
    decisionLog: () => process.env.DECISION_LOG_TABLE || 'decision_log',
    agentActionLog: () => process.env.AGENT_ACTION_LOG_TABLE || 'agent_action_log',
};

/** The overwriting put is for the profile only. The two logs can never be reached through it, whoever calls. */
export function assertOverwritable(table: string): void {
    if (table !== tables.profile()) throw new Error(`${table} is append-only: rows can be added, never overwritten`);
}

/** Turns any value into plain JSON data, so both backends store and return exactly the same thing. */
export function plain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

let documentClient: DynamoDBDocumentClient | undefined;

export function getDocumentClient(): DynamoDBDocumentClient {
    if (!documentClient) {
        const endpoint = process.env.DYNAMODB_ENDPOINT;
        const client = new DynamoDBClient({
            region: process.env.AWS_REGION || 'us-east-1',
            // DynamoDB Local accepts any credentials but the SDK insists on having some
            ...(endpoint ? { endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } } : {}),
        });
        documentClient = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
    }
    return documentClient;
}

const dynamoBackend: Backend = {
    async get(table, key) {
        const out = await getDocumentClient().send(new GetCommand({ TableName: table, Key: key, ConsistentRead: true }));
        return out.Item;
    },

    async put(table, item) {
        assertOverwritable(table);
        await getDocumentClient().send(new PutCommand({ TableName: table, Item: item }));
    },

    async putIfVersion(table, item, expected) {
        assertOverwritable(table);
        try {
            await getDocumentClient().send(new PutCommand({
                TableName: table,
                Item: item,
                ...(expected === 0
                    ? { ConditionExpression: 'attribute_not_exists(userId)' }
                    : { ConditionExpression: '#v = :v', ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': expected } }),
            }));
        } catch (error) {
            if ((error as Error).name === 'ConditionalCheckFailedException') throw new VersionConflictError(table, item.userId);
            throw error;
        }
    },

    async putNew(table, item) {
        try {
            await getDocumentClient().send(new PutCommand({
                TableName: table,
                Item: item,
                ConditionExpression: 'attribute_not_exists(id)',
            }));
        } catch (error) {
            if ((error as Error).name === 'ConditionalCheckFailedException') throw new AlreadyExistsError(table, item.id);
            throw error;
        }
    },

    async query({ table, index, keyName, keyValue, filter }) {
        const names: Record<string, string> = { '#k': keyName };
        const values: Record<string, unknown> = { ':k': keyValue };
        const conditions = Object.entries(filter ?? {}).map(([name, value], i) => {
            names[`#f${i}`] = name;
            values[`:f${i}`] = value;
            return `#f${i} = :f${i}`;
        });
        const items: Item[] = [];
        let startKey: Item | undefined;
        do {
            const out = await getDocumentClient().send(new QueryCommand({
                TableName: table,
                IndexName: index,
                KeyConditionExpression: '#k = :k',
                FilterExpression: conditions.length ? conditions.join(' AND ') : undefined,
                ExpressionAttributeNames: names,
                ExpressionAttributeValues: values,
                ConsistentRead: !index,     // indexes only offer eventually consistent reads
                ExclusiveStartKey: startKey,
            }));
            items.push(...(out.Items ?? []));
            startKey = out.LastEvaluatedKey;
        } while (startKey);
        return items;
    },
};

/** Memory when STORE_BACKEND=memory or under vitest (unless STORE_BACKEND=dynamodb); DynamoDB otherwise. */
export function getBackend(): Backend {
    const choice = process.env.STORE_BACKEND;
    if (choice === 'memory' || (process.env.VITEST && choice !== 'dynamodb')) return memoryBackend;
    return dynamoBackend;
}
