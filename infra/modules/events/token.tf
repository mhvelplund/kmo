resource "random_password" "token" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "token" {
  name                    = "${var.name}/receiver-token"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "token" {
  secret_id     = aws_secretsmanager_secret.token.id
  secret_string = random_password.token.result
}
