require('should');
var sys= require('sys');
var net= require('net');

var Domain= require('../mqtt-domain');
var FixedHeader= Domain.FixedHeader;
var MessageType= Domain.MessageType;
// Utils
var encodeLength= Domain.encodeLength;
var chunker= Domain.chunker;
var utf8StringBuffer= Domain.utf8StringBuffer;

var VERSION= Domain.VERSION;

var Client= function(opts) {
    var self= this;
    opts= opts ? opts : {};

    this.host= opts.host||"::1";
    this.port= opts.port||1883;

    this.username= opts.username;
    this.password= opts.password;
    this.clientId= opts.clientId;

    this.socket= new net.Socket(); 
    this.socket.connect(1883, "::1");

    this.socket.on('connect', function() {
	self.socket.on('data', function(data) {
	    self.socket.emit(data[0]>>4, data);
	});
	self.connect();
    });

    var nextMessageId= 1;
    this.nextMessageId= function() {
	return new Buffer([nextMessageId/256|0, nextMessageId++%256]);
    }
}

Client.prototype.connect= function() {
    if(this.connected) {
	return;
    }

    // Fixed Header
    var FLAGS= 3 << 6;
    var fh= FixedHeader(MessageType.CONNECT, 0, 0, 0);
    var vh= VERSION.concat([FLAGS,0,0x0A]);
    var length= vh.length;
    
    // Get clientID
    var clientID= this.clientId || function() {
	var crypto= require('crypto');
	var hash= crypto.createHash('sha1');
	hash.update(Date()+Math.random());
	return hash.digest('base64').slice(0,23);
    }();

    if(clientID!==undefined) { 
	clientID= new Buffer(clientID); 
	length += clientID.length+2;
    }

    if(this.username!==undefined) {
	var username= new Buffer(this.username);
	length += username.length+2;
    }
    
    if(this.password!==undefined) {
	var password= new Buffer(this.password);
	length += password.length+2;
    }
    
    this.socket.write(new Buffer(fh.concat(length).concat(vh)));
    
    // Push clientID into stream
    if (clientID!==undefined) {
	this.socket.write(new Buffer([0x00,clientID.length]));
	if(clientID.length) { this.socket.write(clientID); }
    }
    
    // Push username into stream
    if (username!==undefined) { 
	this.socket.write(new Buffer([0x00,username.length]));
	this.socket.write(username);
    }
    // Push password into stream
    if (password!==undefined) { 
	this.socket.write(new Buffer([0x00,password.length]));
	this.socket.write(password);
    }

    var self= this;
    this.socket.on(MessageType.CONNACK, function() {
	self.connected= true;	
    });
};

Client.prototype.subscribe= function(topics, callback) {
    // Expecting Array
    if(!(topics instanceof Array)) {
	throw("I'm expecting an Array of topics!");
    }

    var self= this;

    var fh= FixedHeader(MessageType.SUBSCRIBE, 0, 1, 0);
    var vh= this.nextMessageId(); // Message ID
    var length= vh.length;

    topics.forEach(function(_topic) {
	var topic= new Buffer(_topic[0]);
	length += topic.length+3;
    });
	    
    // Write message
    this.socket.write(new Buffer(fh.concat(length)));
    this.socket.write(vh);
    topics.forEach(function(_topic) {
	self.socket.write(new Buffer([0x00,_topic[0].length]));
	self.socket.write(new Buffer(_topic[0].toString()));
	self.socket.write(new Buffer(_topic[1].toString()));
    });

    this.socket.on(MessageType.SUBACK, function(ack) {
	callback(ack);
    });
};

Client.prototype.unsubscribe= function() {
};

Client.prototype.publish= function(topic, buf, callback) {
    var self= this;

    var fh= FixedHeader(MessageType.PUBLISH, 0, 1, 0);

    var topic= utf8StringBuffer(new Buffer(topic));
    var messageId= this.nextMessageId();
    var chunked= chunker(buf);
    var length= encodeLength(topic.length+messageId.length+(buf.length+chunked.length*2));

    // Write Fixed Header
    this.socket.write(new Buffer(fh.concat(length)));
    // Write Variable Header
    this.socket.write(topic);
    this.socket.write(messageId);
    // Write chunked Payload
    chunked.forEach(function(chunk) {
	self.socket.write(utf8StringBuffer(chunk));
    });
	    
    this.socket.on(MessageType.PUBACK, function(ack) {
	callback(ack);
    });
};

describe('MQTT', function() {
    var client = new net.Socket(); 
    client.connect(1883, "::1");
    client.on('connect', function() { 
	// sys.log('* Client connected');
    });

    client.on('data', function(data) {
	client.emit(data[0]>>4, data);
    });

    var config= { 
	username: "santiago",
	password: "santiago"
    };

    function connect(clientID, FLAGS, connack, username, password) {
	// Fixed Header
	var fh= FixedHeader(MessageType.CONNECT, 0, 0, 0);
	var vh= VERSION.concat([FLAGS,0,0x0A]);
	var length= vh.length;

	if(clientID!==undefined) { 
	    clientID= new Buffer(clientID); 
	    length += clientID.length+2;
	}

	if(username!==undefined) {
	    username= new Buffer(username);
	    length += username.length+2;
	}

	if(password!==undefined) {
	    password= new Buffer(password);
	    length += password.length+2;
	}

	client.write(new Buffer(fh.concat(length).concat(vh)));

	// Push clientID into stream
	if (clientID!==undefined) {
	    client.write(new Buffer([0x00,clientID.length]));
	    if(clientID.length) { client.write(clientID); }
	}

	// Push username into stream
	if (username!==undefined) { 
	    client.write(new Buffer([0x00,username.length]));
	    client.write(username);
	}
	// Push password into stream
	if (password!==undefined) { 
	    client.write(new Buffer([0x00,password.length]));
	    client.write(password);
	}
	
	client.on(MessageType.CONNACK, connack);
    }

    function connectMe(FLAGS, connack) {
	connect("santiago", FLAGS, connack, config.username, config.password);
    }

    /*describe('CONNECT/CONNACK', function() {
	beforeEach(function() {
	    client.removeAllListeners(MessageType.CONNACK);
	});

	it("should refuse connection if not acceptable protocol version");
	
	it("should refuse connection if clientID has no length or is not present", function(done) {
	    var FLAGS= 3 << 6; // Username and Password flags set
	    var connack= function(data) {
		data[3].should.equal(2);
		done();
	    };
	    connect("", FLAGS, connack);
	});

	it("should refuse connection if clientID has length > 23", function(done) {
	    var FLAGS= 3 << 6; // Username and Password flags set
	    var connack= function(data) {
		data[3].should.equal(2);
		done();
	    };
	    connect("012345678901234567890123", FLAGS, connack);
	});
	
	it("should refuse connection with return code 5 if username or password flags not set in the Variable Header", function(done) {
	    var FLAGS= 0x80; // Username set and Password flags not set
	    connectMe(FLAGS, function(data) {
		data[3].should.equal(5);
		done();
	    });
	});
	
	it("should refuse connection with return code 4 if username or password not present in payload", function(done) {
	    var FLAGS= 3 << 6; // Username and Password flags set
	    var connack= function(data) {
		data[3].should.equal(4);
		done();
	    };
	    connect("santiago", FLAGS, connack);
	});
	
	it("should refuse connection with return code 4 if wrong username or password", function(done) {
	    var FLAGS= 3 << 6; // Username and Password flags set
	    var connack= function(data) {
		data[3].should.equal(4);
		done();
	    };
	    connect("santiago", FLAGS, connack, "santiag", "santiago");
	});
	
	it("should connect", function(done) {
	    var FLAGS= 3 << 6; // Username and Password flags set
	    connectMe(FLAGS, function(data) {
		data[3].should.equal(0);
		done();
	    });
	});
    });

    describe('SUBSCRIBE/SUBACK', function() {
	it("should respond with a vector of granted QoS levels for each topic name", function(done) {
	    var fh= FixedHeader(MessageType.SUBSCRIBE, 0, 1, 0);
	    var vh= [0x00,10]; // Message ID
	    var length= vh.length;
	    
	    var topic1= new Buffer("salsa");
	    length += topic1.length+3;
	    var topic2= new Buffer("rock");
	    length += topic2.length+3;
	    var topic3= new Buffer("rap");
	    length += topic3.length+3;
	    
	    client.write(new Buffer(fh.concat(length).concat(vh)));

	    // A topic/QoS(0) pair
	    client.write(new Buffer([0x00,topic1.length]));
	    client.write(topic1);
	    client.write('0');
	    // Another topic/QoS(1) pair
	    client.write(new Buffer([0x00,topic2.length]));
	    client.write(topic2);
	    client.write('1');
	    // Yet another topic/QoS(2) pair
	    client.write(new Buffer([0x00,topic3.length]));
	    client.write(topic3);
	    client.write('2');
	    
	    client.on(MessageType.SUBACK, function(data) {
		data[1].should.equal(5); // Length
		data[2].should.equal(0); // MessageID MSB
		data[3].should.equal(10); // MessageID LSB
		// Test topics' qos
		data[4].should.equal(0);
		data[5].should.equal(1);
		data[6].should.equal(2);
		done();
	    });
	});

	it("should contain at least one topic");
    });

    describe('PUBLISH/PUBACK', function() {
	it("should publish", function(done) {
	    var fh= FixedHeader(MessageType.PUBLISH, 0, 1, 0);
	    
	    var topicLength= new Buffer([0x00,5]);
	    var topic= new Buffer("salsa");
	    var messageId= new Buffer([0x00,10]);
	    var payload= function() {
		var output= "01234567890abcdefghijklmnopqrstuvwxyzª!·$%&/()=?¿";
		// while(output.length < 965535) { // Ma' this' big!
		while(output.length < 65535) {
		    output += output;
		}
		return (new Buffer(output));
	    }();
	    var chunked= chunker(payload);
	    
	    var length= encodeLength((topic.length+2)+messageId.length+(payload.length+chunked.length*2));
	    
	    // Write Fixed Header
	    client.write(new Buffer(fh.concat(length)));
	    // Write Variable Header
	    client.write(topicLength);
	    client.write(topic);
	    client.write(messageId);
	    
	    // Write chunked Payload
	    chunked.forEach(function(chunk) {
		client.write(utf8StringBuffer(chunk));
	    });
	    
	    client.on(MessageType.PUBACK, function(data) {
		data[3].should.equal(10);
		done();
	    });
	});
    });
	
    describe('PUBLISH/PUBREC-PUBREL-PUBCOMP', function() {
	it("should publish", function(done) {
	    var fh= FixedHeader(MessageType.PUBLISH, 0, 2, 0);
	    
	    var topicLength= new Buffer([0x00,5]);
	    var topic= new Buffer("salsa");
	    var messageId= new Buffer([0x00,0x0a]);
	    var payload= new Buffer("salsa");
	    var length= encodeLength((topic.length+2)+messageId.length+(payload.length+2));
	    
	    // Write Fixed Header
	    client.write(new Buffer(fh.concat(length)));
	    // Write Variable Header
	    client.write(topicLength);
	    client.write(topic);
	    client.write(messageId);
	    // Write Payload
	    client.write(new Buffer([0x00,payload.length]));
	    client.write(payload);
	    
	    client.on(MessageType.PUBREC, function(data) {
		// Message ID should be 10
		data[3].should.equal(10);
		
		// Respond with PUBREL
		var fh= FixedHeader(MessageType.PUBREL, 0, 1, 0);
		fh= fh.concat([2]); // Remaining Length
		
		client.write(new Buffer(fh));
		client.write(messageId);
	    });
	    
	    client.on(MessageType.PUBCOMP, function(data) {
		// Message ID should be 10
		data[3].should.equal(10);
		done();
	    });
	});
    });

    describe('UNSUBSCRIBE/UNSUBACK', function() {
	it("should unsubscribe", function(done) {
	    var fh= FixedHeader(MessageType.UNSUBSCRIBE, 0, 1, 0);
	    fh= fh.concat([2]);
	    var messageId= new Buffer([0x00,0x0a]);
	    client.write(new Buffer(fh));
	    client.write(messageId);

	    client.on(MessageType.UNSUBACK, function(data) {
		// Remaining Length should be 2
		data[1].should.equal(2);
		// Message ID should be 10
		data[3].should.equal(10);
		done();
	    });
	});
    });

    describe('PINGREQ/PINGRESP', function() {
	it("should ping and get response", function(done) {
	    var fh= FixedHeader(MessageType.PINGREQ, 0, 0, 0);
	    client.write(new Buffer(fh.concat([0]))); // Remaining Lenght is 0

	    client.on(MessageType.PINGRESP, function(data) {
		done();
	    });
	});
    });*/

    describe('Client', function() {
	var _client;
	before(function(done) {
	    _client= new Client({
		username: "santiago",
		password: "santiago",
		clientId: "petardín"
	    });
	    _client.socket.on(MessageType.CONNACK, function(data) {
		done();
	    });
	})


	it("should refuse connection if clientId already taken");

	it("should subscribe topics, publish to those topics, and listen back what was published", function(done) {
	    _client.subscribe([['salsa',1],['hiphop',2]], function(ack) {
		var salsa= false, hiphop= false;
		_client.publish('salsa', new Buffer('salsa'), function(ack) {
		    salsa= true;
		});
		_client.publish('hiphop', new Buffer('hiphop'), function(ack) {
		    hiphop= true;
		});
		setTimeout(function() {
		    if(salsa && hiphop) { done() }
		}, 20)
	    });
	});
    });
});