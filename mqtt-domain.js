module.exports= {
    VERSION: [0x00,0x06,0x4D,0x51,0x49,0x73,0x64,0x70,0x03],

    FixedHeader: function (messageType, dup, qos, retain) {
	return [0x00 | messageType*0x10 | dup*0x08 | qos*0x02 | retain];
    },
    
    MessageType: {
	CONNECT: 1,
	CONNACK: 2,
	PUBLISH: 3,
	PUBACK: 4,
	PUBREC: 5,
	PUBREL: 6,
	PUBCOMP: 7,
	SUBSCRIBE: 8,
	SUBACK: 9,
	UNSUBSCRIBE: 10,
	UNSUBACK: 11,
	PINGREQ: 12,
	PINGRESP: 13,
	DISCONNECT: 14
    },

    DUP: 0x08,
    QOS_0: 0x00,
    QOS_1: 0x02,
    QOS_2: 0x04,

    encodeLength: function(length) {
	var remaining_length= length;
	var byte, remaining_bytes=[], remaining_count=0;
	do {
	    byte = remaining_length % 128;
	    remaining_length = remaining_length / 128;
	    /* If there are more digits to encode, set the top bit of this digit */
	    if(remaining_length > 0){
		byte = byte | 0x80;
	    }
	    remaining_bytes[remaining_count++] = byte;
	} while(remaining_length > 0 && remaining_count < 4);

	remaining_bytes.reverse();
	while(remaining_bytes[0]==128||remaining_bytes[0]==0) {
	    remaining_bytes.shift();
	}
	remaining_bytes[0] -= 128;
	remaining_bytes.reverse();

	return remaining_bytes;
    },

    chunker: function(buffer) {
	var data_count= buffer.length;
	var chunks= [];
	while(data_count > 0) {
	    var size= data_count > 65535 ? 65535 : data_count;
	    var chunk= new Buffer(size);
	    var at= buffer.length-data_count;
	    buffer.copy(chunk, 0, at, at+size);
	    chunks.push(chunk);
	    data_count -= size;
	}
	return chunks;
    },

    utf8StringBuffer: function(buffer) {
	var length= buffer.length;
	if(length > 256*256) {
	    throw("The buffer length exceeds 65535 bytes");
	}
	var utf8Buffer= new Buffer(length+2);
	utf8Buffer[0]= length/256|0;
	utf8Buffer[1]= length%256;
	buffer.copy(utf8Buffer, 2, 0);
	return utf8Buffer;
    }
};