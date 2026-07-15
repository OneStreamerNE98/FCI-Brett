variable "enable_google_resources" {
  description = "Must remain false. This root documents the development boundary and cannot provision Google resources."
  type        = bool
  default     = false

  validation {
    condition     = var.enable_google_resources == false
    error_message = "Development provisioning is prohibited: keep Sites as development and use the reported Cloud project only for the separately approved Workspace test connector."
  }
}
