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

    // [0,6,MQIsdp3]
    var VERSION= [0x00,0x06,0x4D,0x51,0x49,0x73,0x64,0x70,0x03];

    function connect(clientID, FLAGS, connack, username, password) {
	// Fixed Header
	var fh= FixedHeader(MessageType.CONNECT, 0, 0, 0);
	var vh= VERSION.concat([FLAGS,0,0x0A]);
	var clientID= new Buffer(clientID);
	var payloadLength= [0x00,0x08];
	var length= vh.length+payloadLength.length+clientID.length;

	client.write(new Buffer(fh.concat(length).concat(vh).concat(payloadLength)));
	client.write(clientID);
	
	client.on(MessageType.CONNACK, connack);
    }
    
    function connectMe(FLAGS, connack) {
	connect("santiago", FLAGS, connack, "santiago", "santiago");
    }

    describe('CONNECT/CONNACK', function() {
	describe('Fixed Header', function() {
	    it("should check for version 3");

	    it("should check for clientID");

	    it("should validate clientID length [1, 23]");

	    it("should refuse connection if !Username || !Password", function(done) {
		var FLAGS= 0x80; // Username set and Password not set
		connectMe(FLAGS, function(data) {
		    data[3].should.equal(5);
		    done();
		});
	    });

	    it("should check for Username and Password fields", function(done) {
		var FLAGS= 3 << 6; // Username set and Password set
		// connectMe(FLAGS, function(data) {
		//     data[3].should.equal(4);
		//     done();
		// });
		done();
	    });

	    it("should test for race conditions", function(done) {
		done();
	    });
	});

	describe('Variable Header', function() {
	    it('should validate variable header', function(done) {
		done()
	    });
	});
	    
	describe('Payload', function() {
	    it('should validate payload', function(done) {
		done()
	    });
	});
    });
});