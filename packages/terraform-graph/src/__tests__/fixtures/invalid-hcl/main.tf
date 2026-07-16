resource "aws_s3_bucket" "broken" {
  bucket = "invalid-hcl-example"
  # missing closing brace intentionally
