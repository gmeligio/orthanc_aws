import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsManager from "aws-cdk-lib/aws-secretsmanager";
import * as kms from "aws-cdk-lib/aws-kms";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as rds from "aws-cdk-lib/aws-rds";
import * as ecs from "aws-cdk-lib/aws-ecs";

// Constants
const ANY_IPV4_CIDR = "0.0.0.0/0";
const HTTP_PORT = 80;
const ORTHANC_DICOM_SERVER_PORT = 4242;
const ORTHANC_HTTP_SERVER_PORT = 8042;
const POSTGRESQL_PORT = 5432;

const VPC_MAX_AVAILABILITY_ZONES = 2;
const VPC_ID = "Vpc";
const VPC_FLOW_LOGS_CW_LOG_GROUP_ID = "FlowLogsCloudWatchLogGroup";
const VPC_FLOW_LOGS_ID = "FlowLogs";

const ALB_SECURITY_GROUP_ID = "AlbSecurityGroup";

const RDS_CLUSTER_SECURITY_GROUP_ID = "RdsClusterSecurityGroup";
const RDS_PASSWORD_SECRET_ID = "RdsPasswordSecret";
const RDS_USER_SECRET_GENERATOR_EXCLUSION = "'\"@/\\";
const RDS_USER_SECRET_PASSWORD_LENGTH = 16;
const RDS_KMS_KEY_ID = "RdsInstanceKmsKey";
const RDS_USE_MULTIPLE_AVAILABILITY_ZONE = true;
const RDS_DETECTION_PROTECTION = false;
const RDS_ENCRYPT_STORAGE = true;
const RDS_INSTANCE_ID = "RdsInstance";
const RDS_INSTANCE_SIZE_GB = 20;
const RDS_BACKUP_RETENTION_DAYS = 30;
const RDS_INSTANCE_USERNAME = "postgres";

const S3_BUCKET_DICOM_KMS_KEY = "DicomBucketKey";
const S3_BUCKET_DICOM_ID = "DicomBucket";
const S3_ABORT_INCOMPLETE_UPLOAD_DAYS = 30;
const S3_TRANSITION_DAYS = 30;
const S3_ENFORCE_SSL = true;
const S3_AUTO_DELETE_OBJECTS = true;
const S3_VERSION_OBJECTS = true;

const KMS_ENABLE_KEY_ROTATION = true;

const ECS_SECURITY_GROUP_ID = "EcsSecurityGroup";
const ECS_CLUSTER_SECRET = "EcsClusterSecret";
const ECS_CLUSTER_SECRET_TEMPLATE = {};
const ECS_CLUSTER_SECRET_KEY = "admin";
const ECS_CLUSTER_SECRET_GENERATOR_EXCLUSION = "'\"@/\\";
const ECS_CLUSTER_SECRET_PASSWORD_LENGTH = 16;
const ECS_CLUSTER_ID = "EcsCluster";
const ECS_LOG_DRIVER_STREAM_PREFFIX = "ecs-orthanc";

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
      ALB_SECURITY_GROUP_ID,
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
    const dicomImageBucket = new s3.Bucket(this, S3_BUCKET_DICOM_ID, {
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
          excludeCharacters: RDS_USER_SECRET_GENERATOR_EXCLUSION,
          passwordLength: RDS_USER_SECRET_PASSWORD_LENGTH,
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
      multiAz: RDS_USE_MULTIPLE_AVAILABILITY_ZONE,
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
  }
}
