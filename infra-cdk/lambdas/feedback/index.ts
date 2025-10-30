import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'crypto';

const dynamodb = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME!;

interface FeedbackRequest {
  sessionId: string;
  message: string;
  isThumbsUp: boolean;
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
  };

  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    if (!event.body) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Request body is required' }),
      };
    }

    const body: FeedbackRequest = JSON.parse(event.body);

    if (!body.sessionId || !body.message || typeof body.isThumbsUp !== 'boolean') {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'sessionId, message, and isThumbsUp are required' }),
      };
    }

    const claims = event.requestContext.authorizer?.claims;
    if (!claims) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }

    const username = claims['cognito:username'] || claims.email || 'unknown';
    const feedbackId = randomUUID();
    const timestamp = Date.now();

    await dynamodb.send(
      new PutItemCommand({
        TableName: TABLE_NAME,
        Item: {
          feedbackId: { S: feedbackId },
          sessionId: { S: body.sessionId },
          message: { S: body.message },
          username: { S: username },
          isThumbsUp: { BOOL: body.isThumbsUp },
          timestamp: { N: timestamp.toString() },
        },
      })
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, feedbackId }),
    };
  } catch (error) {
    console.error('Error saving feedback:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
