resource "aws_s3_bucket" "logs" {
  bucket = "explicit-depends-on-logs"
}

resource "aws_s3_bucket" "assets" {
  bucket     = "explicit-depends-on-assets"
  depends_on = [aws_s3_bucket.logs]
}
