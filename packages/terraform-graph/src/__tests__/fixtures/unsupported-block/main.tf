moved {
  from = aws_s3_bucket.old_name
  to   = aws_s3_bucket.assets
}

resource "aws_s3_bucket" "assets" {
  bucket = "unsupported-block-assets"
}
