resource "aws_cloudwatch_event_connection" "receiver" {
  name               = "${var.name}-receiver"
  authorization_type = "API_KEY"

  auth_parameters {
    api_key {
      key   = "Authorization"
      value = "Bearer ${random_password.token.result}"
    }
  }
}

resource "aws_cloudwatch_event_api_destination" "receiver" {
  name                             = "${var.name}-receiver"
  connection_arn                   = aws_cloudwatch_event_connection.receiver.arn
  invocation_endpoint              = "${var.api_endpoint}/events/eventbridge"
  http_method                      = "POST"
  invocation_rate_limit_per_second = 10
}

resource "aws_cloudwatch_event_rule" "store" {
  name = "${var.name}-store-changes"
  event_pattern = jsonencode({
    source        = ["aws.s3"]
    "detail-type" = ["Object Created", "Object Deleted"]
    detail        = { bucket = { name = [var.bucket] } }
  })
}

data "aws_iam_policy_document" "events_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "invoke" {
  statement {
    actions   = ["events:InvokeApiDestination"]
    resources = [aws_cloudwatch_event_api_destination.receiver.arn]
  }
}

resource "aws_iam_role" "invoke" {
  name               = "${var.name}-invoke-receiver"
  assume_role_policy = data.aws_iam_policy_document.events_trust.json
}

resource "aws_iam_role_policy" "invoke" {
  name   = "invoke-receiver"
  role   = aws_iam_role.invoke.id
  policy = data.aws_iam_policy_document.invoke.json
}

resource "aws_sqs_queue" "dead_letters" {
  name                      = "${var.name}-dead-letters"
  message_retention_seconds = 86400
}

data "aws_iam_policy_document" "dead_letters" {
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.dead_letters.arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_event_rule.store.arn]
    }
  }
}

resource "aws_sqs_queue_policy" "dead_letters" {
  queue_url = aws_sqs_queue.dead_letters.id
  policy    = data.aws_iam_policy_document.dead_letters.json
}

resource "aws_cloudwatch_event_target" "receiver" {
  rule     = aws_cloudwatch_event_rule.store.name
  arn      = aws_cloudwatch_event_api_destination.receiver.arn
  role_arn = aws_iam_role.invoke.arn

  retry_policy {
    maximum_event_age_in_seconds = 3600
    maximum_retry_attempts       = 10
  }

  dead_letter_config {
    arn = aws_sqs_queue.dead_letters.arn
  }
}

resource "aws_cloudwatch_log_group" "events" {
  name              = "/aws/events/${var.name}"
  retention_in_days = 1
}

data "aws_iam_policy_document" "events_to_logs" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.events.arn}:*"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com", "delivery.logs.amazonaws.com"]
    }
  }
}

resource "aws_cloudwatch_log_resource_policy" "events" {
  policy_name     = "${var.name}-events"
  policy_document = data.aws_iam_policy_document.events_to_logs.json
}

resource "aws_cloudwatch_event_target" "log" {
  rule = aws_cloudwatch_event_rule.store.name
  arn  = aws_cloudwatch_log_group.events.arn
}
