variable "api_token" {
  type      = string
  sensitive = true
  default   = "should-not-appear-in-output"
}

resource "aws_ssm_parameter" "token" {
  name  = "sensitive-variable-token"
  type  = "SecureString"
  value = var.api_token
}
