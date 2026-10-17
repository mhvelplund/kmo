resource "aws_security_group" "vpc_link" {
  name        = "${var.name}-vpc-link"
  description = "The VPC link of the API"
  vpc_id      = var.vpc_id
}

resource "aws_security_group" "nlb" {
  name        = "${var.name}-nlb"
  description = "The NLB in front of the receiver"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_egress_rule" "vpc_link_to_nlb" {
  security_group_id            = aws_security_group.vpc_link.id
  referenced_security_group_id = aws_security_group.nlb.id
  ip_protocol                  = "tcp"
  from_port                    = 80
  to_port                      = 80
}

resource "aws_vpc_security_group_ingress_rule" "nlb_from_vpc_link" {
  security_group_id            = aws_security_group.nlb.id
  referenced_security_group_id = aws_security_group.vpc_link.id
  ip_protocol                  = "tcp"
  from_port                    = 80
  to_port                      = 80
}

resource "aws_vpc_security_group_egress_rule" "nlb_to_receiver" {
  security_group_id            = aws_security_group.nlb.id
  referenced_security_group_id = var.node_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
}

resource "aws_vpc_security_group_ingress_rule" "receiver_from_nlb" {
  security_group_id            = var.node_security_group_id
  referenced_security_group_id = aws_security_group.nlb.id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
  description                  = "The NLB reaches the receiver"
}

resource "aws_lb" "receiver" {
  name                             = "${var.name}-receiver"
  internal                         = true
  load_balancer_type               = "network"
  subnets                          = var.subnet_ids
  security_groups                  = [aws_security_group.nlb.id]
  enable_cross_zone_load_balancing = true
}

resource "aws_lb_target_group" "receiver" {
  name                 = "${var.name}-receiver"
  port                 = 8080
  protocol             = "TCP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 10

  health_check {
    protocol            = "HTTP"
    path                = "/readyz"
    port                = "traffic-port"
    interval            = 10
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }
}

resource "aws_lb_listener" "receiver" {
  load_balancer_arn = aws_lb.receiver.arn
  port              = 80
  protocol          = "TCP"

  tcp_idle_timeout_seconds = 600

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.receiver.arn
  }
}

resource "aws_apigatewayv2_api" "events" {
  name          = "${var.name}-events"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_vpc_link" "receiver" {
  name               = "${var.name}-receiver"
  subnet_ids         = var.subnet_ids
  security_group_ids = [aws_security_group.vpc_link.id]
}

resource "aws_apigatewayv2_integration" "receiver" {
  api_id                 = aws_apigatewayv2_api.events.id
  integration_type       = "HTTP_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lb_listener.receiver.arn
  connection_type        = "VPC_LINK"
  connection_id          = aws_apigatewayv2_vpc_link.receiver.id
  payload_format_version = "1.0"
  request_parameters     = { "overwrite:path" = "/events/eventbridge" }
}

resource "aws_apigatewayv2_route" "events" {
  api_id    = aws_apigatewayv2_api.events.id
  route_key = "POST /events/eventbridge"
  target    = "integrations/${aws_apigatewayv2_integration.receiver.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.events.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 20
    throttling_rate_limit  = 10
  }
}
