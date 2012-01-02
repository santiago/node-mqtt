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