resource "aws_s3_bucket" "should_not_be_discovered" {
  bucket = "should-not-appear"
}
