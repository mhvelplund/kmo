variable "name" {
  description = "The prefix of every name."
  type        = string
}

variable "bucket" {
  description = "The config bucket whose events go to the receiver."
  type        = string
}

variable "api_endpoint" {
  description = "The public HTTPS address of the API in front of the receiver."
  type        = string
}
