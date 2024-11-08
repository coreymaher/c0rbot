"use strict";

const AWS = require("aws-sdk");
const request = require("request");

const docClient = new AWS.DynamoDB.DocumentClient();

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
  return new Promise((resolve, reject) => {
    const params = {
      TableName: process.env.table,
      Key: { name: key },
    };

    docClient.get(params, (err, data) => {
      if (err) {
        console.error("DynamoDB.get error:");
        console.error(err);
        console.error(params);
      }

      resolve(data);
    });
  });
};

module.exports.updateFeedData = async (key, feedData) => {
  return new Promise((resolve, reject) => {
    const params = {
      TableName: process.env.table,
      Item: {
        name: key,
        feed_data: feedData,
        updated_at: Date.now(),
      },
    };

    docClient.put(params, (err) => {
      if (err) {
        console.error("DynamoDB.put error:");
        console.error(err);
        console.error(params);
      }

      resolve();
    });
  });
};
