resource "aws_s3_bucket" "assets" {
  bucket = "module-output-reference-assets"
}

output "bucket_name" {
  value = aws_s3_bucket.assets.bucket
}
