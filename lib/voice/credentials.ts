import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { SigningCredentials } from './presign';

export const AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';

// The credentials the web app runs with: the task role on ECS, the AWS_* variables locally. The DynamoDB client is
// already a dependency and resolves them with the standard provider chain (and refreshes them before they expire),
// so asking it avoids a second AWS package just for this.
let provider: DynamoDBClient['config']['credentials'] | undefined;

export async function signingCredentials(): Promise<SigningCredentials> {
    provider ??= new DynamoDBClient({ region: AWS_REGION }).config.credentials;
    const { accessKeyId, secretAccessKey, sessionToken } = await provider();
    return { accessKeyId, secretAccessKey, sessionToken };
}
