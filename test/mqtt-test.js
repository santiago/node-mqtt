require('should');
var sys= require('sys');
var net= require('net');

var Domain= require('../mqtt-domain')
var FixedHeader= Domain.FixedHeader;
var MessageType= Domain.MessageType;

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

    // [0,6,MQIsdp3]
    var VERSION= [0x00,0x06,0x4D,0x51,0x49,0x73,0x64,0x70,0x03];

    function connect(clientID, FLAGS, connack, username, password) {
	// Fixed Header
	var fh= FixedHeader(MessageType.CONNECT, 0, 0, 0);
	var vh= VERSION.concat([FLAGS,0,0x0A]);
	var length= vh.length;

	clientID= new Buffer(clientID);
	length += clientID.length+2;

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
	client.write(new Buffer([0x00,clientID.length]));
	client.write(clientID);

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

    describe('CONNECT/CONNACK', function() {
	beforeEach(function() {
	    client.removeAllListeners(MessageType.CONNACK);
	});

	it("should check for version 3");
	
	it("should check for clientID");
	
	it("should validate clientID length [1, 23]");
	
	it("should refuse connection with return code 5 if username or password flags not set in variable header", function(done) {
	    var FLAGS= 0x80; // Username set and Password not set
	    connectMe(FLAGS, function(data) {
		data[3].should.equal(5);
		done();
	    });
	});
	
	it("should refuse connection with return code 4 if username or password not present in payload", function(done) {
	    var FLAGS= 3 << 6; // Username and Password set
	    var connack= function(data) {
		data[3].should.equal(4);
		done();
	    };
	    connect("santiago", FLAGS, connack);
	});
	
	it("should refuse connection with return code 4 if wrong username or password", function(done) {
	    var FLAGS= 3 << 6; // Username and Password set
	    var connack= function(data) {
		data[3].should.equal(4);
		done();
	    };
	    connect("santiago", FLAGS, connack, "santiag", "santiago");
	});
	
	it("should refuse connection with return code 3");
	it("should refuse connection with return code 2");
	
	it('should validate variable header', function() {
	});

	it('should validate payload', function() {
	});
    });
});
