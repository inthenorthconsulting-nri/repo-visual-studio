variable "bucket_names" {
  type    = list(string)
  default = ["primary", "replica"]
}

resource "aws_s3_bucket" "assets" {
  for_each = toset(var.bucket_names)
  bucket   = "dynamic-for-each-${each.value}"
}
