#!/usr/bin/env node
// Creates the three DynamoDB tables if they do not exist yet. Safe to run again.
// AWS:    node scripts/create-tables.mjs            (uses your AWS credentials, region AWS_REGION or us-east-1)
// Local:  DYNAMODB_ENDPOINT=http://localhost:8000 node scripts/create-tables.mjs
import 'dotenv/config';
import { CreateTableCommand, DescribeTableCommand, DynamoDBClient, waitUntilTableExists } from '@aws-sdk/client-dynamodb';

const endpoint = process.env.DYNAMODB_ENDPOINT;
const region = process.env.AWS_REGION || 'us-east-1';
const client = new DynamoDBClient({
    region,
    ...(endpoint ? { endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } } : {}),
});

const text = (name) => ({ AttributeName: name, AttributeType: 'S' });
const hash = (name) => ({ AttributeName: name, KeyType: 'HASH' });
const range = (name) => ({ AttributeName: name, KeyType: 'RANGE' });

const tables = [
    {
        TableName: process.env.PROFILE_TABLE || 'profile_config',
        AttributeDefinitions: [text('userId')],
        KeySchema: [hash('userId')],
    },
    {
        TableName: process.env.DECISION_LOG_TABLE || 'decision_log',
        AttributeDefinitions: [text('userId'), text('id')],
        KeySchema: [hash('userId'), range('id')],
    },
    {
        TableName: process.env.AGENT_ACTION_LOG_TABLE || 'agent_action_log',
        AttributeDefinitions: [text('userId'), text('id'), text('actionId')],
        KeySchema: [hash('userId'), range('id')],
        // Reads every row of one agent request together
        GlobalSecondaryIndexes: [
            { IndexName: 'byAction', KeySchema: [hash('actionId'), range('id')], Projection: { ProjectionType: 'ALL' } },
        ],
    },
];

console.log(`DynamoDB at ${endpoint || `AWS ${region}`}`);
for (const table of tables) {
    const name = table.TableName;
    let existed = true;
    try {
        await client.send(new DescribeTableCommand({ TableName: name }));
    } catch (error) {
        if (error.name !== 'ResourceNotFoundException') throw error;
        existed = false;
        await client.send(new CreateTableCommand({ ...table, BillingMode: 'PAY_PER_REQUEST' }));
    }
    await waitUntilTableExists({ client, maxWaitTime: 120 }, { TableName: name });
    console.log(`${existed ? 'exists ' : 'created'}  ${name}  ACTIVE`);
}
