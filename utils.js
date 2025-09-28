"use strict";

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} = require("@aws-sdk/lib-dynamodb");
const request = require("request");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

module.exports.simpleGet = async (url, options = {}) => {
  return new Promise((resolve, reject) => {
    request({ url, ...options }, (err, response, body) => {
      if (err) {
        console.error(`request error ${url}:`);
        console.error(err);
      }

      resolve(body);
    });
  });
};

module.exports.loadFeedData = async (key) => {
  try {
    const params = {
      TableName: process.env.table,
      Key: { name: key },
    };

    const data = await docClient.send(new GetCommand(params));
    return data;
  } catch (err) {
    console.error("DynamoDB.get error:");
    console.error(err);
    console.error({ TableName: process.env.table, Key: { name: key } });
    return {};
  }
};

module.exports.updateFeedData = async (key, feedData) => {
  try {
    const params = {
      TableName: process.env.table,
      Item: {
        name: key,
        feed_data: feedData,
        updated_at: Date.now(),
      },
    };

    await docClient.send(new PutCommand(params));
  } catch (err) {
    console.error("DynamoDB.put error:");
    console.error(err);
    console.error({
      TableName: process.env.table,
      Item: { name: key, feed_data: feedData, updated_at: Date.now() },
    });
  }
};
