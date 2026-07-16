variable "vpc_id" {
  type        = string
  description = "ID of the VPC this log group is associated with (informational; not referenced by aws_cloudwatch_log_group itself)"
}

variable "environment" {
  type        = string
  description = "Deployment environment name, used to namespace the log group"
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/rvs-self-hosting/${var.environment}/app"
  retention_in_days = 14
}
