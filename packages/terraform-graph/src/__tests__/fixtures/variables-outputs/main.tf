variable "environment" {
  type        = string
  description = "Deployment environment name"
  default     = "staging"
}

resource "aws_s3_bucket" "assets" {
  bucket = "variables-outputs-${var.environment}"
}

output "bucket_name" {
  description = "Name of the created bucket"
  value       = aws_s3_bucket.assets.bucket
}
