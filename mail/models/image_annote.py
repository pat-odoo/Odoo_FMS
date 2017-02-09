from odoo import _, api, fields, models
from odoo import tools

class Circle(models.Model):
	_name = "mail.imageeditor.circle"	

	color = fields.Char()
	html_id = fields.Char()
	attachment_id = fields.Many2one('ir.attachment');
	top_cord = fields.Integer()
	left_cord = fields.Integer()
	message_ids = fields.One2many("mail.imageeditor.message",'circle_id')
	subject = fields.Char()

class Message(models.Model):
	_name = "mail.imageeditor.message"

	author = fields.Char()
	body = fields.Char()
	circle_id = fields.Many2one('mail.imageeditor.circle');