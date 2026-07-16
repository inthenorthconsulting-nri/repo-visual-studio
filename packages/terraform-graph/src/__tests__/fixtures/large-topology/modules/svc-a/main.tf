resource "aws_s3_bucket" "b0" {
  bucket = "large-topology-svc-a-b0"
}

resource "aws_s3_bucket" "b1" {
  bucket     = "large-topology-svc-a-b1"
  depends_on = [aws_s3_bucket.b0]
}

resource "aws_s3_bucket" "b2" {
  bucket     = "large-topology-svc-a-b2"
  depends_on = [aws_s3_bucket.b0]
}

resource "aws_s3_bucket" "b3" {
  bucket     = "large-topology-svc-a-b3"
  depends_on = [aws_s3_bucket.b0]
}

resource "aws_s3_bucket" "b4" {
  bucket     = "large-topology-svc-a-b4"
  depends_on = [aws_s3_bucket.b0]
}

resource "aws_s3_bucket" "b5" {
  bucket     = "large-topology-svc-a-b5"
  depends_on = [aws_s3_bucket.b0]
}

resource "aws_s3_bucket" "b6" {
  bucket     = "large-topology-svc-a-b6"
  depends_on = [aws_s3_bucket.b0]
}

resource "aws_s3_bucket" "b7" {
  bucket     = "large-topology-svc-a-b7"
  depends_on = [aws_s3_bucket.b0]
}

resource "aws_s3_bucket" "b8" {
  bucket     = "large-topology-svc-a-b8"
  depends_on = [aws_s3_bucket.b0]
}

