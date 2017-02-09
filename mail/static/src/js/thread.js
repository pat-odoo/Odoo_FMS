odoo.define('mail.ChatThread', function (require) {
"use strict";

var core = require('web.core');
var Widget = require('web.Widget');
var ajax = require('web.ajax');
var Model = require('web.Model');
var session = require('web.session');

var QWeb = core.qweb;
var _t = core._t;

var ORDER = {
    ASC: 1,
    DESC: -1,
};

var read_more = _t('read more');
var read_less = _t('read less');

function time_from_now(date) {
    if (moment().diff(date, 'seconds') < 45) {
        return _t("now");
    }
    return date.fromNow();
}

var Thread = Widget.extend({
    className: 'o_mail_thread',

    events: {
        // "click .o_image": function(e){
        //     e.preventDefault();
        //     var url = $(e.currentTarget).attr('href').replace("?download=true", "");
        //     window.open(url);
        // },
        "click .o_image_editor": 'open_image_editor',
        "click a": "on_click_redirect",
        "click img": "on_click_redirect",
        "click strong": "on_click_redirect",
        "click .o_thread_show_more": "on_click_show_more",
        "click .o_thread_message_needaction": function (event) {
            var message_id = $(event.currentTarget).data('message-id');
            this.trigger("mark_as_read", message_id);
        },
        "click .o_thread_message_star": function (event) {
            var message_id = $(event.currentTarget).data('message-id');
            this.trigger("toggle_star_status", message_id);
        },
        "click .o_thread_message_reply": function (event) {
            this.selected_id = $(event.currentTarget).data('message-id');
            this.$('.o_thread_message').removeClass('o_thread_selected_message');
            this.$('.o_thread_message[data-message-id="' + this.selected_id + '"]')
                .addClass('o_thread_selected_message');
            this.trigger('select_message', this.selected_id);
            event.stopPropagation();
        },
        "click .oe_mail_expand": function (event) {
            event.preventDefault();
            var $message = $(event.currentTarget).parents('.o_thread_message');
            $message.addClass('o_message_expanded');
            this.expanded_msg_ids.push($message.data('message-id'));
        },
        "click .o_thread_message": function (event) {
            $(event.currentTarget).toggleClass('o_thread_selected_message');
        },
        "click": function () {
            if (this.selected_id) {
                this.unselect();
                this.trigger('unselect_message');
            }
        },
    },

    init: function (parent, options) {
        this._super.apply(this, arguments);
        this.options = _.defaults(options || {}, {
            display_order: ORDER.ASC,
            display_needactions: true,
            display_stars: true,
            display_document_link: true,
            display_avatar: true,
            squash_close_messages: true,
            display_email_icon: true,
            display_reply_icon: false,
        });
        this.expanded_msg_ids = [];
        this.selected_id = null;
    },

    render: function (messages, options) {
        var self = this;
        var msgs = _.map(messages, this._preprocess_message.bind(this));
        if (this.options.display_order === ORDER.DESC) {
            msgs.reverse();
        }
        options = _.extend({}, this.options, options);

        // Hide avatar and info of a message if that message and the previous
        // one are both comments wrote by the same author at the same minute
        // and in the same document (users can now post message in documents
        // directly from a channel that follows it)
        var prev_msg;
        _.each(msgs, function (msg) {
            if (!prev_msg || (Math.abs(msg.date.diff(prev_msg.date)) > 60000) ||
                prev_msg.message_type !== 'comment' || msg.message_type !== 'comment' ||
                (prev_msg.author_id[0] !== msg.author_id[0]) || prev_msg.model !== msg.model ||
                prev_msg.res_id !== msg.res_id) {
                msg.display_author = true;
            } else {
                msg.display_author = !options.squash_close_messages;
            }
            prev_msg = msg;
        });

        this.$el.html(QWeb.render('mail.ChatThread', {
            messages: msgs,
            options: options,
            ORDER: ORDER,
        }));

        _.each(msgs, function(msg) {
            var $msg = self.$('.o_thread_message[data-message-id="'+ msg.id +'"]');
            $msg.find('.o_mail_timestamp').data('date', msg.date);

            self.insert_read_more($msg);
        });

        if (!this.update_timestamps_interval) {
            this.update_timestamps_interval = setInterval(function() {
                self.update_timestamps();
            }, 1000*60);
        }
    },

    /**
     *  Modifies $element to add the 'read more/read less' functionality
     *  All element nodes with "data-o-mail-quote" attribute are concerned.
     *  All text nodes after a ""#stopSpelling" element are concerned.
     *  Those text nodes need to be wrapped in a span (toggle functionality).
     *  All consecutive elements are joined in one 'read more/read less'.
     */
    insert_read_more: function ($element) {
        var self = this;

        var groups = [];
        var read_more_nodes;

        // nodeType 1: element_node
        // nodeType 3: text_node
        var $children = $element.contents()
            .filter(function() {
                return this.nodeType === 1 || this.nodeType === 3 && this.nodeValue.trim();
            });

        _.each($children, function(child) {
            var $child = $(child);

            // Hide Text nodes if "stopSpelling"
            if (child.nodeType === 3 && $child.prevAll("[id*='stopSpelling']").length > 0) {
                // Convert Text nodes to Element nodes
                var $child = $('<span>', {
                    text: child.textContent,
                    "data-o-mail-quote": "1",
                });
                child.parentNode.replaceChild($child[0], child);
            }

            // Create array for each "read more" with nodes to toggle
            if ($child.attr('data-o-mail-quote') || ($child.get(0).nodeName === 'BR' && $child.prev("[data-o-mail-quote='1']").length > 0)) {
                if (!read_more_nodes) {
                    read_more_nodes = [];
                    groups.push(read_more_nodes);
                }
                $child.hide();
                read_more_nodes.push($child);
            } else {
                read_more_nodes = undefined;
                self.insert_read_more($child);
            }
        });

        _.each(groups, function(group) {
            // Insert link just before the first node
            var $read_more = $('<a>', {
                class: "o_mail_read_more",
                href: "#",
                text: read_more,
            }).insertBefore(group[0]);

            // Toggle All next nodes
            var is_read_more = true;
            $read_more.click(function(e) {
                e.preventDefault();
                is_read_more = !is_read_more;
                _.each(group, function ($child) {
                    $child.hide();
                    $child.toggle(!is_read_more);
                });
                $read_more.text(is_read_more ? read_more : read_less);
            });
        });
    },
    update_timestamps: function () {
        this.$('.o_mail_timestamp').each(function() {
            var date = $(this).data('date');
            $(this).html(time_from_now(date));
        });
    },
    on_click_redirect: function (event) {
        var id = $(event.target).data('oe-id');
        if (id) {
            event.preventDefault();
            var model = $(event.target).data('oe-model');
            var options = model && (model !== 'mail.channel') ? {model: model, id: id} : {channel_id: id};
            this._redirect(options);
        }
    },

    _redirect: _.debounce(function (options) {
        if ('channel_id' in options) {
            this.trigger('redirect_to_channel', options.channel_id);
        } else {
            this.trigger('redirect', options.model, options.id);
        }
    }, 200, true),

    on_click_show_more: function () {
        this.trigger('load_more_messages');
    },

    _preprocess_message: function (message) {
        var msg = _.extend({}, message);

        msg.date = moment.min(msg.date, moment());
        msg.hour = time_from_now(msg.date);

        var date = msg.date.format('YYYY-MM-DD');
        if (date === moment().format('YYYY-MM-DD')) {
            msg.day = _t("Today");
        } else if (date === moment().subtract(1, 'days').format('YYYY-MM-DD')) {
            msg.day = _t("Yesterday");
        } else {
            msg.day = msg.date.format('LL');
        }

        if (_.contains(this.expanded_msg_ids, message.id)) {
            msg.expanded = true;
        }

        msg.display_subject = message.subject && message.message_type !== 'notification' && !(message.model && (message.model !== 'mail.channel'));
        msg.is_selected = msg.id === this.selected_id;
        return msg;
    },

    /**
     * Removes a message and re-renders the thread
     * @param {int} [message_id] the id of the removed message
     * @param {array} [messages] the list of messages to display, without the removed one
     * @param {object} [options] options for the thread rendering
     */
    remove_message_and_render: function (message_id, messages, options) {
        var self = this;
        var done = $.Deferred();
        this.$('.o_thread_message[data-message-id="' + message_id + '"]').fadeOut({
            done: function () { self.render(messages, options); done.resolve();},
            duration: 200,
        });
        return done;
    },

    /**
     * Scrolls the thread to a given message or offset if any, to bottom otherwise
     * @param {int} [options.id] optional: the id of the message to scroll to
     * @param {int} [options.offset] optional: the number of pixels to scroll
     */
    scroll_to: function (options) {
        options = options || {};
        if (options.id !== undefined) {
            var $target = this.$('.o_thread_message[data-message-id="' + options.id + '"]');
            if (options.only_if_necessary) {
                var delta = $target.parent().height() - $target.height();
                var offset = delta < 0 ? 0 : delta - ($target.offset().top - $target.offsetParent().offset().top);
                offset = - Math.min(offset, 0);
                this.$el.scrollTo("+=" + offset + "px", options);
            } else if ($target.length) {
                this.$el.scrollTo($target);
            }
        } else if (options.offset !== undefined) {
            this.$el.scrollTop(options.offset);
        } else {
            this.$el.scrollTop(this.el.scrollHeight);
        }
    },
    get_scrolltop: function () {
        return this.$el.scrollTop();
    },
    is_at_bottom: function () {
        return this.el.scrollHeight - this.$el.scrollTop() - this.$el.outerHeight() < 5;
    },
    unselect: function () {
        this.$('.o_thread_message').removeClass('o_thread_selected_message');
        this.selected_id = null;
    },
    destroy: function () {
        clearInterval(this.update_timestamps_interval);
    },
    open_image_editor: function(e){
        var att_id = $(e.currentTarget).data('att_id');
        var image_editor = new ImageEditor(this, att_id);
        image_editor.appendTo('body');
    }
});

//////////////////////////////////////////////////////////////////////////////////////////////

var ImageEditor = Widget.extend({
    template: 'mail.ChatThread.ImageEditor',
    events: {
        'click .o_close_editor': 'on_editor_click',
        'click .o_editor_image' : 'o_editor_image_click',
        'click .o_annoted_circle_blue_color' : 'o_annoted_circle_blue_color_click',
        'mousedown .o_editor_image' : 'o_editor_image_mousedown',
        'click': 'o_image_div_click',
        'click #btn_show' : 'btn_show_hide_click',
        // 'click .color_picker_all':'change_colorPicker_click',
        'click .btn_rect': 'btn_ractangle_annotation_click',
        'click .btn_circle': 'btn_circle_annotation_click',

    },
    init: function(parent, att_id){
        this.parent = parent;
        this.att_id = att_id;
        this.child_circle = [];
        this.blank_child_circle = [];
        this.circle_db_id = 0;
        this.image_editor_model = new Model('mail.imageeditor.circle');
        return this._super();
    },
    start:function(){
        
        this.$annoted_div = this.$el.find(".o_image_annoted_div");        
        
        var self = this;
        var domain = [['attachment_id','=',this.att_id]];
        this.image_editor_model.call('search_read', [domain]).then(function(result) {
            
                _.each(result, function(circle){
                    var circles = new Circle(circle.top_cord,circle.left_cord,self.$annoted_div,circle.id,'hide_state',self,self,circle.subject,circle.color);
                    circles.appendTo(self.$annoted_div);
                    self.child_circle.push(circles);
                });
        });
    },
    o_image_div_click: function(e){

    },
    btn_ractangle_annotation_click:function(){
        var ractangle_annoted = this.$el.find(".btn_rect");
        var circle_annoted = this.$el.find(".btn_circle");
        
        $(ractangle_annoted).removeClass("btn-default");
        $(circle_annoted).removeClass("btn-primary");

        $(ractangle_annoted).addClass("btn-primary");
        $(circle_annoted).addClass("btn-default");
       
    },
    btn_circle_annotation_click:function(){
        var ractangle_annoted = this.$el.find(".btn_rect");
        var circle_annoted = this.$el.find(".btn_circle");
        
        $(ractangle_annoted).removeClass("btn-primary");
        $(circle_annoted).removeClass("btn-default");

        $(ractangle_annoted).addClass("btn-default");
        $(circle_annoted).addClass("btn-primary");
        
    },
    // change_colorPicker_click:function(e){
    //     var clr = $( e.target ).css( "background-color" );
    //     $( "#pic" ).css( "background-color",clr);
    // },
    btn_show_hide_click:function(e){
       if($("#btn_show").hasClass("btn btn-primary")){
            $("#btn_show").attr({"class":"btn btn-danger","title":"Hide annotation"});
            $("#icn").attr({"class":"fa fa-eye-slash"});
            this.hide_all_circles();        
        }
        else
        {
            $("#btn_show").attr({"class":"btn btn-primary","title":"Show annotation"});
            $("#icn").attr({"class":"fa fa-eye"});
            this.show_all_circles();
        }
    },
    on_editor_click: function(e){
        this.destroy();
    },
    hide_all_circles:function(){
        _.each(this.child_circle, function(circle){
            $(circle.$el).addClass('o_hidden');
        });
        this.clear_all();
    },
    show_all_circles:function(){
        _.each(this.child_circle, function(circle){
            $(circle.$el).removeClass('o_hidden');
        });
    },
    clear_all : function(){
        _.each(this.child_circle, function(circle){
            $(circle.comment_box.$el).addClass('o_hidden');
        });
        
        _.each(this.blank_child_circle, function(circle){
            if(circle.comment_box.comment_id == 0){
                circle.close_circle();
            }
        });
    },

    o_editor_image_click : function(e){


        if($(e.target).hasClass('o_annoted_circle')){
            return;
        }
 
        this.clear_all();

        var offset = $(e.currentTarget).offset()
        var imageLeft = offset.left;
        var clickLeft = e.pageX;
        var howFarFromLeft = clickLeft - imageLeft - 10;

        var imagetop = offset.top;
        var clicktop = e.pageY;
        var howFarFromtop = clicktop - imagetop - 10;

        this.$annoted_div = this.$el.find(".o_image_annoted_div");
        var circle = new Circle(howFarFromtop,howFarFromLeft,this.$annoted_div,this.circle_db_id,'show_state',this,this.att_id,"Your Subject");
        circle.appendTo(this.$annoted_div);
        
        this.blank_child_circle.push(circle);
        /*var values = {
            "circles": [[0, 0, {"top_cord": howFarFromtop,"left_cord" : howFarFromLeft}]]
        }*/
    },
            
    o_editor_image_mousedown : function(e){

            /*this.$annoted_div = this.$el.find(".o_image_annoted_div");
            var click_y = e.pageY,
                click_x = e.pageX;
            var $selection = $('<div>').addClass('selection-box');

            $selection.appendTo(this.$annoted_div);

            $(this.$annoted_div).mousemove(function (e) {
                var move_x = e.pageX,
                    move_y = e.pageY,
                    width  = Math.abs(move_x - click_x),
                    height = Math.abs(move_y - click_y),
                    new_x, new_y;

                new_x = (move_x < click_x) ? (click_x - width) : click_x;
                new_y = (move_y < click_y) ? (click_y - height) : click_y;

                $selection.css({
                    'width': width,
                    'height': height,
                    'top': new_y,
                    'left': new_x,
                    'border-color' : 'red'
                });

            }).mouseup(function () {
                $(".o_image_annoted_div").off('mousemove');
            });*/
    },

});

var Circle = Widget.extend({
    template: 'mail.ChatThread.ImageEditor.Circle',
    events: {
        'click .o_annoted_circle' : 'o_annoted_circle_click',

    },
    init: function(howFarFromtop,howFarFromLeft,parent,id,state,parent_obj,att_id,subject,circle_color){
        this.circle_top = howFarFromtop;
        this.circle_left = howFarFromLeft;
        this.parent = parent;
        this.id = id;
        this.circle_color = circle_color;
        this.state = state;
        this.att_id = att_id;
        this.image_editor_object = parent_obj;  
        this.subject_text = subject;
        this.circle_object = this; 
        return this._super();
    },
    start: function()
    {
        
        ///////////vandan/////////////


        var clr=$( "#pic" ).css( "background-color");
        var current_circle=this.$el.find(".o_annoted_circle");
        $(current_circle).css( {"background-color":this.circle_color});
        $( "#pic" ).css( "background-color",clr);


        //////////////////////////////


        var self = this;
        this.comment_box = new CommentBox(this.circle_top,this.circle_left,this.id,this.state,this,this.image_editor_object);
        return this._super().then(function(){
            self.comment_box.appendTo(self.parent);
        });
    },
    set_id : function(id){
        this.id = id;
    },
    close_circle:function(){
        this.destroy();
        this.comment_box.destroy();
    },
    o_annoted_circle_click : function(e){
        this.image_editor_object.clear_all();
        var comment_hide = $(this.comment_box.$el);
        comment_hide.removeClass('o_hidden');
    },

});

var CommentBox = Widget.extend({
    template: 'mail.ChatThread.ImageEditor.CommentBox',
    events: {
        'click .o_comment_box_close' : 'o_comment_box_close_click',
        'click .o_comment_box_send' : 'o_comment_box_send_click',
        'click #cmnt_subject_edit_btn' : 'cmnt_subject_edit_btn_click',
        'click #save_subject':'save_subject_click',
        'click #cancel_subject':'cancel_subject_click',
        'click .panel_btn_resolved':'panel_btn_resolved_click',
        'click .panel_btn_rejected':'panel_btn_rejected_click',
        'click .panel_btn_in_progress':'panel_btn_in_progress_click',
    },
    init: function(howFarFromtop,howFarFromLeft,id,state,parent_obj,image_editor_object){
        this.commentbox_top =  howFarFromtop + 15;
        this.commentbox_left = howFarFromLeft + 15;
        this.comment_id = id;
        this.state = state;
        this.image_editor_object = image_editor_object;  
        this.circle_object = parent_obj;
        return this._super();
    },
    start:function(){
        this.$chatter_div = this.$el.find(".o_comment_box_chatter_div");  
        this.$subject_div = this.$el.find("#cmnt_subject");
        this.image_editor_message_model = new Model('mail.imageeditor.message');
        var self = this;
        var domain = [['circle_id','=',this.comment_id]]
        var subject_text = self.circle_object.subject_text;

        // setting In progress/ resolved/ reject color btn color

        if (self.circle_object.circle_color == '#ffc107'){
            self.$el.find('.panel_btn_in_progress').css('background-color','#ffc107');
        }
        else if (self.circle_object.circle_color == '#E53935'){
            self.$el.find('.panel_btn_rejected').css('background-color','#E53935');
        }
        else if (self.circle_object.circle_color == '#198c75'){
            self.$el.find('.panel_btn_resolved').css('background-color','#198c75');
        }
        self.$subject_div.text(subject_text);


        this.image_editor_message_model.call('search_read', [domain]).then(function(result) {
            
                _.each(result, function(message){
                    var $chat = $('<div>' + message.body + '</div>');
                    $chat.appendTo(self.$chatter_div);
                    
                });
        });
        if (this.state == "hide_state"){
            this.do_hide();
        }
    },
    o_comment_box_close_click:function(){
        if(this.comment_id == 0){
            this.circle_object.close_circle();
        }
        else
            this.do_hide();
    },
    o_comment_box_send_click : function(){
        
        this.mess_values;
        this.subject_text = this.$el.find('#cmnt_subject').text();
        this.$chatter_div = this.$el.find(".o_comment_box_chatter_div");
        var message = this.$el.find(".o_chat_box").val();
        this.$el.find(".o_chat_box").val('');
        var $chat = $('<div>' + message + '</div>');
        $chat.appendTo(this.$chatter_div);
        
        if(this.comment_id == 0){
            this.image_editor_model_circle = new Model('mail.imageeditor.circle');
            var values = {
                "attachment_id" : this.image_editor_object.att_id,
                "top_cord": this.commentbox_top - 15,
                "left_cord" : this.commentbox_left - 15,
                "color" : '#ffc107',
                "subject" : this.subject_text

            };
            var self = this;       
            this.image_editor_model_circle.call('create',[values]).then(function (res) {
                self.mess_values = {
                    "circle_id" : res,
                    "body": message,
                    "author" : session.name,
                };
                self.comment_id = res;
                self.circle_object.id = res;
                self.image_editor_object.child_circle.push(self.circle_object);
                self.image_editor_model_message = new Model('mail.imageeditor.message');
                self.image_editor_model_message.call('create',[self.mess_values]).then(function (res) {
                    
                });

            });
            
        }else{
            this.mess_values = {
                    "circle_id" : this.comment_id,
                    "body": message,
                    "author" : session.name,
                    "subject" : this.subject_text
                };
            this.image_editor_model_message = new Model('mail.imageeditor.message');
            this.image_editor_model_message.call('create',[this.mess_values]).then(function (res) {
                    
            });
        }
    },
    cmnt_subject_edit_btn_click : function(e){
        this.$el.find('#cmnt_subject').attr('contenteditable','true');
        this.$el.find('#save_subject').removeClass("o_hidden");
        this.$el.find('#cancel_subject').removeClass("o_hidden");
        this.$el.find('#cmnt_subject_edit_btn').addClass("o_hidden");
        this.subject_text = this.$el.find('#cmnt_subject').text();
        this.$el.find('#cmnt_subject').css('background-color','gray');

    },
    save_subject_click : function(e){
        this.$el.find('#cmnt_subject').attr('contenteditable','false');
        this.$el.find('#save_subject').addClass("o_hidden");
        this.$el.find('#cancel_subject').addClass("o_hidden");
        this.$el.find('#cmnt_subject_edit_btn').removeClass("o_hidden");
        this.subject_text =  this.$el.find('#cmnt_subject').text();
        this.$el.find('#cmnt_subject').css('background-color','#875a7b');

        var Model_save_subject = new Model('mail.imageeditor.circle');
        Model_save_subject.call('write',[[this.circle_object.id],{'subject':this.subject_text}]);
    },
    cancel_subject_click : function(e){
        this.$el.find('#cmnt_subject').attr('contenteditable','false');
        this.$el.find('#save_subject').addClass("o_hidden");
        this.$el.find('#cancel_subject').addClass("o_hidden");
        this.$el.find('#cmnt_subject_edit_btn').removeClass("o_hidden");
        this.$el.find('#cmnt_subject').text(this.subject_text);    
        this.$el.find('#cmnt_subject').css('background-color','#875a7b');

    },
    panel_btn_resolved_click : function(e){
        this.$el.find(".panel_btn_resolved").css('background-color','#198c75');
        this.circle_object.$el.find('.o_annoted_circle').css('background-color','#198c75');

        this.$el.find(".panel_btn_in_progress").css('background-color','grey');
        this.$el.find(".panel_btn_rejected").css('background-color','grey');

        var Model_save_color = new Model('mail.imageeditor.circle');
        Model_save_color.call('write',[[this.circle_object.id],{'color':'#198c75'}]);
    },
    panel_btn_rejected_click : function(e){
            this.$el.find(".panel_btn_rejected").css('background-color','#E53935');
            this.circle_object.$el.find('.o_annoted_circle').css('background-color','#E53935');

            this.$el.find(".panel_btn_resolved").css('background-color','grey');
            this.$el.find(".panel_btn_in_progress").css('background-color','grey');

        var Model_save_color = new Model('mail.imageeditor.circle');
        Model_save_color.call('write',[[this.circle_object.id],{'color':'#E53935'}]);
    },
    panel_btn_in_progress_click : function(e){
        this.$el.find(".panel_btn_in_progress").css('background-color','#ffc107');
        this.circle_object.$el.find('.o_annoted_circle').css('background-color','#ffc107');

        this.$el.find(".panel_btn_resolved").css('background-color','grey');
        this.$el.find(".panel_btn_rejected").css('background-color','grey');

        var Model_save_color = new Model('mail.imageeditor.circle');
        Model_save_color.call('write',[[this.circle_object.id],{'color':'#ffc107'}]);


    }
});

Thread.ORDER = ORDER;

return Thread;

});