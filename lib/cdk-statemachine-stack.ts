import * as cdk from '@aws-cdk/core';
import * as lambda from '@aws-cdk/aws-lambda';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks';
import * as secretsmanager from "@aws-cdk/aws-secretsmanager";
import { AttributeType, BillingMode, Table } from '@aws-cdk/aws-dynamodb';
import { RemovalPolicy } from '@aws-cdk/core';
import { DynamoAttributeValue, DynamoGetItem } from '@aws-cdk/aws-stepfunctions-tasks';

export class CdkStatemachineStack extends cdk.Stack {
  public Machine: sfn.StateMachine;
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const stageName = "dev001";
    const defaults = {
      "scraper-endpoint": "mock-table-scraper",
      workFlow: "autoGenerateFullArticle",
      "article-id": "1",
      url: "https://comicbook.com/gaming/news/playstation-4-ps4-ps-vita-exclusive-games-servers-down/",
      "user-id": "1001",
    };

    //table
    const gpt3WorkflowTable = new Table(
      this,
      `gpt3-workflow-${stageName}`,
      {
        tableName: `gpt3-workflow-${stageName}`,
        billingMode: BillingMode.PROVISIONED,
        readCapacity: 1,
        writeCapacity: 1,
        removalPolicy: RemovalPolicy.DESTROY,
        partitionKey: {
          name: "gpt3-workflow-id",
          type: AttributeType.STRING,
        },
        pointInTimeRecovery: true,
      }
    );
    

    // States language JSON to put an item into DynamoDB
    // snippet generated from https://docs.aws.amazon.com/step-functions/latest/dg/tutorial-code-snippet.html#tutorial-code-snippet-1
    const stateJson = {
      Type: 'Task',
      Resource: 'arn:aws:states:::aws-sdk:secretsmanager:getSecretValue',
      Parameters: {
        "SecretId.$": "$.api-key-id"  //"jurassic-1-key"
      },
      InputPath:  "$.workflow-settings",
      ResultPath: "$.secret",
    };

    // custom state which represents a task to insert data into DynamoDB
    const custom = new sfn.CustomState(this, 'get-api-key-secret', {
      stateJson,
    });

    // Lambda to generate a random number
    const generateRandomNumber = new lambda.Function(this, 'GenerateRandomNumber', {
      runtime: lambda.Runtime.NODEJS_14_X,
      code: lambda.Code.fromAsset('lambda'),
      handler: 'generateRandomNumber.handler',
      timeout: cdk.Duration.seconds(3)
    });

    //Lambda invocation for generating a random number
    const generateRandomNumberInvocation = new tasks.LambdaInvoke(this, 'Generate random number invocation', {
      lambdaFunction: generateRandomNumber,
      outputPath: '$.Payload',
    });

    // Lambda function called if the generated number is greater than the expected number
    const functionGreaterThan = new lambda.Function(this, "NumberGreaterThan", {
      runtime: lambda.Runtime.NODEJS_14_X,
      code: lambda.Code.fromAsset('lambda'),
      handler: 'greater.handler',
      timeout: cdk.Duration.seconds(3)
    });

    // Lambda invocation if the generated number is greater than the expected number
    const greaterThanInvocation = new tasks.LambdaInvoke(this, 'Get Number is greater than invocation', {
      lambdaFunction: functionGreaterThan,
      inputPath: '$',
      outputPath: '$',
    });

    // Lambda function called if the generated number is less than or equal to the expected number
    const functionLessThanOrEqual = new lambda.Function(this, "NumberLessThan", {
      runtime: lambda.Runtime.NODEJS_14_X,
      code: lambda.Code.fromAsset('lambda'),
      handler: 'lessOrEqual.handler',
      timeout: cdk.Duration.seconds(3)
    });

    // Lambda invocation if the generated number is less than or equal to the expected number
    const lessThanOrEqualInvocation = new tasks.LambdaInvoke(this, 'Get Number is less than or equal invocation', {
      lambdaFunction: functionLessThanOrEqual,
      inputPath: '$',
      outputPath: '$',
    });

    //Condition to wait 1 second
    const wait1Second = new sfn.Wait(this, "Wait 1 Second", {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(1)),
    });

    //Choice condition for workflow
    const numberChoice = new sfn.Choice(this, 'Job Complete?')
      .when(sfn.Condition.numberGreaterThanJsonPath('$.generatedRandomNumber', '$.numberToCheck'), greaterThanInvocation)
      .when(sfn.Condition.numberLessThanEqualsJsonPath('$.generatedRandomNumber', '$.numberToCheck'), lessThanOrEqualInvocation)
      .otherwise(lessThanOrEqualInvocation);

      const ddbGetItem = new DynamoGetItem(
        this,
        `Get Item from gpt3-workflow-${stageName}`,
        {
          key: {
            "gpt3-workflow-id": DynamoAttributeValue.fromString(
              defaults.workFlow
            ),
          },
          table: gpt3WorkflowTable,
          resultSelector: {
            "api-endpoint.$": "$.Item.api-endpoint['S']",
            "api-key-id.$": "$.Item.api-key-id['S']",
            "prompt-sequence.$": "$.Item.prompt-sequence",
          },
          resultPath: "$.workflow-settings"
        }
      )      

    //Create the workflow definition
    const definition = generateRandomNumberInvocation.next(ddbGetItem).next(custom).next(wait1Second)
      .next(numberChoice);

    //Create the statemachine
    this.Machine = new sfn.StateMachine(this, "StateMachine", {
      definition,
      stateMachineName: 'randomNumberStateMachine',
      timeout: cdk.Duration.minutes(5),
    });
  }
}
