terraform {
  required_providers {
    databricks = {
      source  = "databricks/databricks"
      version = "~> 1.0"
    }
  }
}

provider "databricks" {
  host = "https://example.cloud.databricks.com"
}

resource "databricks_cluster" "analytics" {
  cluster_name            = "databricks-provider-analytics"
  spark_version            = "13.3.x-scala2.12"
  node_type_id             = "i3.xlarge"
  autotermination_minutes  = 20
}
