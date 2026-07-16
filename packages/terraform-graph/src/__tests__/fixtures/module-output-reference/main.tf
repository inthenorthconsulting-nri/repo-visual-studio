module "child" {
  source = "./modules/child"
}

output "child_bucket_name" {
  value = module.child.bucket_name
}
