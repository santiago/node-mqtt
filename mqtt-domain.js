console.log("domain");
module.exports= {
    FixedHeader: function (messageType, dup, qos, retain) {
	return [0x00 | messageType*0x10 | dup | qos | retain];
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
    QOS_2: 0x04
};

// Encode Decimal
function encodeLength(decimal) {
    // do {
    //     var digit = X MOD 128;
    //     var X = X DIV 128;
    //     // if there are more digits to encode, set the top bit of this digit
    //     if ( X > 0 ) {
    //         digit = digit OR 0x80
    //     }
    // } while ( X> 0 )
}

// Decode to Decimal
function decodeLength(encoded) {
    // var multiplier = 1 
    // var value = 0 
    // do {
    //     var digit = 'next digit from stream' 
    //     var value += (digit & 127) * multiplier 
    //     multiplier *= 128
    // } while ((digit & 128) != 0)
}