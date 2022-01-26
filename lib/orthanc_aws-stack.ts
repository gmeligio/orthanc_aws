import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsManager from "aws-cdk-lib/aws-secretsmanager";
import * as kms from "aws-cdk-lib/aws-kms";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as rds from "aws-cdk-lib/aws-rds";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudfrontOrigins from "aws-cdk-lib/aws-cloudfront-origins";

// Generic constants
const ANY_IPV4_CIDR = "0.0.0.0/0";
const HTTP_PORT = 80;
const ORTHANC_DICOM_SERVER_PORT = 4242;
const ORTHANC_HTTP_SERVER_PORT = 8042;
const POSTGRESQL_PORT = 5432;

// AWS constants
const ENABLE_MULTIPLE_AVAILABILITY_ZONES = true;

// VPC constants
const VPC_MAX_AVAILABILITY_ZONES = 2;
const VPC_ID = "Vpc";
const VPC_FLOW_LOGS_CW_LOG_GROUP_ID = "FlowLogsCloudWatchLogGroup";
const VPC_FLOW_LOGS_ID = "FlowLogs";

// ELB constants
const ELB_ALB_SECURITY_GROUP_ID = "AlbSecurityGroup";
const ELB_ALB_ID = "EcsFargateServiceAlb";
const ELB_ALB_HAS_INTERNET_ROUTE = true;

// RDS constants
const RDS_CLUSTER_SECURITY_GROUP_ID = "RdsClusterSecurityGroup";
const RDS_PASSWORD_SECRET_ID = "RdsPasswordSecret";
const RDS_KMS_KEY_ID = "RdsInstanceKmsKey";
const RDS_DETECTION_PROTECTION = false;
const RDS_ENCRYPT_STORAGE = true;
const RDS_INSTANCE_ID = "RdsInstance";
const RDS_INSTANCE_SIZE_GB = 20;
const RDS_BACKUP_RETENTION_DAYS = 30;
const RDS_INSTANCE_USERNAME = "postgres";

// S3 constants
const S3_BUCKET_DICOM_KMS_KEY = "DicomBucketKey";
const S3_BUCKET_DICOM_ID = "DicomBucket";
const S3_ABORT_INCOMPLETE_UPLOAD_DAYS = 30;
const S3_TRANSITION_DAYS = 30;
const S3_ENFORCE_SSL = true;
const S3_AUTO_DELETE_OBJECTS = true;
const S3_VERSION_OBJECTS = true;

// Secrets Manager constants
const SECRET_GENERATOR_EXCLUSION = "'\"@/\\";
const SECRET_GENERATOR_PASSWORD_LENGTH = 16;

// KMS constants
const KMS_ENABLE_KEY_ROTATION = true;

// Orthanc constants
const ORTHANC_LOCAL_DOMAIN_SLD_SUFFIX = ".compute.internal-orthanconaws.local";
const ORTHANC_ENABLE_DICOM_WEB_PLUGIN = "true";
const ORTHANC_POSTGRESQL_USERNAME = RDS_INSTANCE_USERNAME;
const ORTHANC_ENABLE_STONE_WEB_VIEWER_PLUGIN = "true";
const ORTHANC_DEFAULT_STORAGE_BUNDLE = "false";
const ORTHANC_LD_LIBRARY_PATH = "/usr/local/lib";
const ORTHANC_ENABLE_WSI_PLUGIN = "true";
const ORTHANC_BEFORE_STARTUP_SCRIPT = "";
const ORTHANC_CONNECTION_TIMEOUT = 30;
const ORTHANC_REQUEST_TIMEOUT = 1200;
const ORTHANC_ROOT_PATH = "";
const ORTHANC_STORAGE_STRUCTURE = "flat";
const ORTHANC_ENABLE_MIGRATION_FROM_FILE_SYSTEM = false;

// ECS constants
const ECS_SECURITY_GROUP_ID = "EcsSecurityGroup";
const ECS_CLUSTER_SECRET = "EcsClusterSecret";
const ECS_CLUSTER_SECRET_TEMPLATE = {};
const ECS_CLUSTER_SECRET_KEY = "admin";
const ECS_CLUSTER_ID = "EcsCluster";
const ECS_LOG_DRIVER_STREAM_PREFFIX = "ecs-orthanc";
const ECS_TASK_DEFINITION_ID = "EcsTaskDefinition";
const ECS_MEMORY_LIMIT_MIB = 4096;
const ECS_CPU_UNITS = 2048;
const ECS_LINUX_PARAMETERS_ID = "EcsContainerLinuxParams";
const ECS_CONTAINER_DEFINITION_ID = "EcsContainer";
const ECS_CONTAINER_IMAGE_ASSET_PATH = "./lib/s3-plugin/";
const ECS_LINUX_ENABLE_INIT_PROCESS = true;
const ECS_FARGATE_SERVICE_ID = "EcsFargateService";
const ECS_FARGATE_SERVICE_HEALTH_CHECK_INTERVAL_SECONDS = 60;
const ECS_FARGATE_SERVICE_HEALTH_CHECK_CODES = "200-499";
const ECS_FARGATE_SERVICE_HEALTH_CHECK_PATH = "/";
const ECS_FARGATE_SERVICE_CPU_SCLAING_ID = "EcsServiceCpuScaling";
const ECS_FARGATE_SERVICE_MEMORY_SCALING_ID = "EcsServiceMemoryScaling";

// Cloudfront constants
const CLOUDFRONT_ORIGIN_REQUEST_POLICY_ID = "OriginRequestPolicy";
const CLOUDFRONT_ORIGIN_REQUEST_POLICY_COMMENT = "Policy optimised for Orthanc";
const CLOUDFRONT_DISTRIBUTION_ID = "OrthancDistribution";

// CDK output constants
const CDK_OUTPUT_ECS_CLUSTER_SECRET_ID = "OrthancCredentialsName";
const CDK_OUTPUT_ECS_CLUSTER_SECRET_DESCRIPTION =
  "The name of the OrthancCredentials secret";
const CDK_OUTPUT_ECS_CLUSTER_SECRET_NAME = "ecsClusterSecretName";
const CDK_OUTPUT_CLOUDFRONT_DISTRIBUTION_URL_ID = "CdkOutputOrthancUrl";
const CDK_OUTPUT_CLOUDFRONT_DISTRIBUTION_URL_DESCRIPTION =
  "Orthanc Distribution URL";
const CDK_OUTPUT_CLOUDFRONT_DISTRIBUTION_URL_NAME = "cloudfrontDistributionURL";

export class OrthancAwsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Infrastructure

    /* Network layer */

    // Create VPC
    const vpc = new ec2.Vpc(this, VPC_ID, {
      maxAzs: VPC_MAX_AVAILABILITY_ZONES, // Default is all AZs in region
    });

    // Publish VPC flow logs to CloudWatch Logs
    const logGroup = new logs.LogGroup(this, VPC_FLOW_LOGS_CW_LOG_GROUP_ID);

    vpc.addFlowLog(VPC_FLOW_LOGS_ID, {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(logGroup),
      trafficType: ec2.FlowLogTrafficType.ALL,
    });

    // Allow inbound traffic from HTTP into the load balancer
    const loadBalancerSecurityGroup = new ec2.SecurityGroup(
      this,
      ELB_ALB_SECURITY_GROUP_ID,
      { vpc: vpc }
    );
    loadBalancerSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(ANY_IPV4_CIDR),
      ec2.Port.tcp(HTTP_PORT)
    );

    // Allow inbound traffic from load balancer's HTTP and Orcthanc's DICOM and HTTP server
    const ecsSecurityGroup = new ec2.SecurityGroup(
      this,
      ECS_SECURITY_GROUP_ID,
      { vpc: vpc, allowAllOutbound: true }
    );
    ecsSecurityGroup.addIngressRule(
      loadBalancerSecurityGroup,
      ec2.Port.tcp(HTTP_PORT)
    );
    ecsSecurityGroup.addIngressRule(
      loadBalancerSecurityGroup,
      ec2.Port.tcp(ORTHANC_DICOM_SERVER_PORT)
    );
    ecsSecurityGroup.addIngressRule(
      loadBalancerSecurityGroup,
      ec2.Port.tcp(ORTHANC_HTTP_SERVER_PORT)
    );

    // Allow all traffic from itself
    ecsSecurityGroup.addIngressRule(ecsSecurityGroup, ec2.Port.allTraffic());

    // Allow inbound traffic into PostgreSQL
    const rdsClusterSecurityGroup = new ec2.SecurityGroup(
      this,
      RDS_CLUSTER_SECURITY_GROUP_ID,
      { vpc: vpc }
    );
    rdsClusterSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(POSTGRESQL_PORT)
    );

    /* Storage layer */

    // Create a rotating KMS key for the image bucket
    const bucketKmsKey = new kms.Key(this, S3_BUCKET_DICOM_KMS_KEY, {
      enableKeyRotation: KMS_ENABLE_KEY_ROTATION,
    });

    // Create the DICOM image bucket with encryption and versioning enabled.
    const dicomBucket = new s3.Bucket(this, S3_BUCKET_DICOM_ID, {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: bucketKmsKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: S3_ENFORCE_SSL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: S3_AUTO_DELETE_OBJECTS,
      versioned: S3_VERSION_OBJECTS,
      lifecycleRules: [
        {
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(
            S3_ABORT_INCOMPLETE_UPLOAD_DAYS
          ),
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: cdk.Duration.days(S3_TRANSITION_DAYS),
            },
          ],
        },
      ],
    });

    // Let Secrets Manager generate the RDS user password
    const rdsPasswordSecret = new secretsManager.Secret(
      this,
      RDS_PASSWORD_SECRET_ID,
      {
        generateSecretString: {
          excludeCharacters: SECRET_GENERATOR_EXCLUSION,
          passwordLength: SECRET_GENERATOR_PASSWORD_LENGTH,
        },
      }
    );

    // Create a rotating KMS key for the image bucket
    const rdsKmsKey = new kms.Key(this, RDS_KMS_KEY_ID, {
      enableKeyRotation: KMS_ENABLE_KEY_ROTATION,
    });

    // Create a RDS for PostgreSQL instance
    const rdsInstance = new rds.DatabaseInstance(this, RDS_INSTANCE_ID, {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_11,
      }),
      multiAz: ENABLE_MULTIPLE_AVAILABILITY_ZONES,
      deletionProtection: RDS_DETECTION_PROTECTION,
      storageType: rds.StorageType.GP2,
      storageEncrypted: RDS_ENCRYPT_STORAGE,
      storageEncryptionKey: rdsKmsKey,
      allocatedStorage: RDS_INSTANCE_SIZE_GB,
      backupRetention: cdk.Duration.days(RDS_BACKUP_RETENTION_DAYS),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE3,
        ec2.InstanceSize.MEDIUM
      ),
      credentials: rds.Credentials.fromPassword(
        RDS_INSTANCE_USERNAME,
        rdsPasswordSecret.secretValue
      ),
      vpc: vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
      },
      securityGroups: [rdsClusterSecurityGroup],
    });

    /* Compute layer */

    // Let Secrets Manager generate the ECS cluster credentials
    const ecsClusterSecret = new secretsManager.Secret(
      this,
      ECS_CLUSTER_SECRET,
      {
        generateSecretString: {
          secretStringTemplate: JSON.stringify(ECS_CLUSTER_SECRET_TEMPLATE),
          generateStringKey: ECS_CLUSTER_SECRET_KEY,
          excludeCharacters: SECRET_GENERATOR_EXCLUSION,
          passwordLength: SECRET_GENERATOR_PASSWORD_LENGTH,
        },
      }
    );

    // Create the ECS Cluster inside the VPC
    const ecsCluster = new ecs.Cluster(this, ECS_CLUSTER_ID, {
      vpc: vpc,
    });

    // Create CloudWatch Logs stream for the ECS Cluster
    const ecsLogDriver = new ecs.AwsLogDriver({
      streamPrefix: ECS_LOG_DRIVER_STREAM_PREFFIX,
    });

    // Create the ECS Task Definition
    const ecsTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      ECS_TASK_DEFINITION_ID,
      {
        memoryLimitMiB: ECS_MEMORY_LIMIT_MIB,
        cpu: ECS_CPU_UNITS,
      }
    );

    // Create storage configuration for the Orthanc server
    const orthancConfig = {
      AwsS3Storage: {
        BucketName: dicomBucket.bucketName,
        Region: cdk.Aws.REGION,
        ConnectionTimeout: ORTHANC_CONNECTION_TIMEOUT,
        RequestTimeout: ORTHANC_REQUEST_TIMEOUT,
        RootPath: ORTHANC_ROOT_PATH,
        StorageStructure: ORTHANC_STORAGE_STRUCTURE,
        MigrationFromFileSystemEnabled:
          ORTHANC_ENABLE_MIGRATION_FROM_FILE_SYSTEM,
      },
    };

    // Create the ECS Container definition for the Orthanc server
    const ecsContainerDefinition = ecsTaskDefinition.addContainer(
      ECS_CONTAINER_DEFINITION_ID,
      {
        image: ecs.ContainerImage.fromAsset(ECS_CONTAINER_IMAGE_ASSET_PATH),
        logging: ecsLogDriver,
        environment: {
          ORTHANC__POSTGRESQL__HOST: rdsInstance.dbInstanceEndpointAddress,
          ORTHANC__POSTGRESQL__PORT: rdsInstance.dbInstanceEndpointPort,
          LOCALDOMAIN: `${cdk.Aws.REGION}${ORTHANC_LOCAL_DOMAIN_SLD_SUFFIX}`,
          DICOM_WEB_PLUGIN_ENABLED: ORTHANC_ENABLE_DICOM_WEB_PLUGIN,
          ORTHANC__POSTGRESQL__USERNAME: ORTHANC_POSTGRESQL_USERNAME,
          STONE_WEB_VIEWER_PLUGIN_ENABLED:
            ORTHANC_ENABLE_STONE_WEB_VIEWER_PLUGIN,
          STORAGE_BUNDLE_DEFAULTS: ORTHANC_DEFAULT_STORAGE_BUNDLE,
          LD_LIBRARY_PATH: ORTHANC_LD_LIBRARY_PATH,
          WSI_PLUGIN_ENABLED: ORTHANC_ENABLE_WSI_PLUGIN,
          ORTHANC_JSON: JSON.stringify(orthancConfig),
          BEFORE_ORTHANC_STARTUP_SCRIPT: ORTHANC_BEFORE_STARTUP_SCRIPT,
        },
        secrets: {
          ORTHANC__REGISTERED_USERS:
            ecs.Secret.fromSecretsManager(ecsClusterSecret),
          ORTHANC__POSTGRESQL__PASSWORD:
            ecs.Secret.fromSecretsManager(rdsPasswordSecret),
        },
        linuxParameters: new ecs.LinuxParameters(
          this,
          ECS_LINUX_PARAMETERS_ID,
          {
            initProcessEnabled: ECS_LINUX_ENABLE_INIT_PROCESS,
          }
        ),
        portMappings: [
          {
            containerPort: ORTHANC_HTTP_SERVER_PORT,
            hostPort: ORTHANC_HTTP_SERVER_PORT,
            protocol: ecs.Protocol.TCP,
          },
          {
            containerPort: ORTHANC_DICOM_SERVER_PORT,
            hostPort: ORTHANC_DICOM_SERVER_PORT,
            protocol: ecs.Protocol.TCP,
          },
        ],
      }
    );

    // Allow the ECS task to access the ECS cluster secret
    ecsClusterSecret.grantRead(ecsContainerDefinition.taskDefinition.taskRole);

    // Allow the ECS task to access the RDS instance password secret
    rdsPasswordSecret.grantRead(ecsContainerDefinition.taskDefinition.taskRole);

    // Allow the ECS tontainer to access the DICOM Bucket
    dicomBucket.grantReadWrite(ecsTaskDefinition.taskRole);

    // Create the ALB for the ECS task
    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, ELB_ALB_ID, {
      vpc: vpc,
      securityGroup: loadBalancerSecurityGroup,
      internetFacing: ELB_ALB_HAS_INTERNET_ROUTE,
    });

    // Create the ECS Fargate service with a load balancer
    const ecsFargateService =
      new ecsPatterns.ApplicationLoadBalancedFargateService(
        this,
        ECS_FARGATE_SERVICE_ID,
        {
          cluster: ecsCluster,
          loadBalancer: loadBalancer,
          taskDefinition: ecsTaskDefinition,
          // desiredCount: ENABLE_MULTIPLE_AVAILABILITY_ZONES
          //   ? ECS_FARGATE_SERVICE_MULTI_AZ_INSTANCE_COUNT
          //   : 1,
          platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
          securityGroups: [ecsSecurityGroup],
        }
      );

    const ecsScalableTarget = ecsFargateService.service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 10,
    });

    ecsScalableTarget.scaleOnCpuUtilization(
      ECS_FARGATE_SERVICE_CPU_SCLAING_ID,
      {
        targetUtilizationPercent: 75,
      }
    );

    ecsScalableTarget.scaleOnMemoryUtilization(
      ECS_FARGATE_SERVICE_MEMORY_SCALING_ID,
      {
        targetUtilizationPercent: 75,
      }
    );

    // Configure health check for the ECS Fargate service
    // Taking into account 2xx codes and 4xx codes because 401 is the default state of for unauthenticated requests
    ecsFargateService.targetGroup.configureHealthCheck({
      path: ECS_FARGATE_SERVICE_HEALTH_CHECK_PATH,
      interval: cdk.Duration.seconds(
        ECS_FARGATE_SERVICE_HEALTH_CHECK_INTERVAL_SECONDS
      ),
      healthyHttpCodes: ECS_FARGATE_SERVICE_HEALTH_CHECK_CODES,
    });

    /* Network layer */

    // Create a Cloudfront origin policy
    const cloudfrontOriginRequestPolicy = new cloudfront.OriginRequestPolicy(
      this,
      CLOUDFRONT_ORIGIN_REQUEST_POLICY_ID,
      {
        comment: CLOUDFRONT_ORIGIN_REQUEST_POLICY_COMMENT,
        cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
        headerBehavior: cloudfront.OriginRequestHeaderBehavior.all(),
        queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      }
    );

    const cloudfrontDistribution = new cloudfront.Distribution(
      this,
      CLOUDFRONT_DISTRIBUTION_ID,
      {
        defaultBehavior: {
          origin: new cloudfrontOrigins.LoadBalancerV2Origin(loadBalancer, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          }),
          originRequestPolicy: cloudfrontOriginRequestPolicy,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        },
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2019,
      }
    );

    /* Stack deployment outputs */

    // Output the ECS cluster secret name
    new cdk.CfnOutput(this, CDK_OUTPUT_ECS_CLUSTER_SECRET_ID, {
      value: ecsClusterSecret.secretName,
      description: CDK_OUTPUT_ECS_CLUSTER_SECRET_DESCRIPTION,
      exportName: CDK_OUTPUT_ECS_CLUSTER_SECRET_NAME,
    });

    // Output the Cloudfront distribution URL
    new cdk.CfnOutput(this, CDK_OUTPUT_CLOUDFRONT_DISTRIBUTION_URL_ID, {
      value: cloudfrontDistribution.distributionDomainName,
      description: CDK_OUTPUT_CLOUDFRONT_DISTRIBUTION_URL_DESCRIPTION,
      exportName: CDK_OUTPUT_CLOUDFRONT_DISTRIBUTION_URL_NAME,
    });
  }
}
