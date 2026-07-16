variable "db_password" {
  type      = string
  sensitive = true
  default   = "should-not-appear"
}

variable "replica_count" {
  type    = number
  default = 1
}

resource "aws_db_instance" "primary" {
  count      = var.replica_count
  password   = var.db_password
  identifier = "db-${count.index}"
}

output "password_out" {
  value     = var.db_password
  sensitive = true
}
