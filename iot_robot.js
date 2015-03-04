//*****************************************************************************
// Copyright (c) 2014 IBM Corporation and other Contributors.
//
// All rights reserved. This program and the accompanying materials
// are made available under the terms of the Eclipse Public License v1.0
// which accompanies this distribution, and is available at
// http://www.eclipse.org/legal/epl-v10.html 
//
// Contributors:
//  IBM - Initial Contribution
//      - update for iot-2, registration and commands
//*****************************************************************************

// IoT Cloud Example Client
// To run on a PCDuino equipped with a distance sensor and motor drivers

var util = require('util');
var async = require('async');
var mqtt = require('mqtt');
var getmac = require('getmac');
var properties = require('properties');
var fs = require('fs');
var duino = require( 'iotduino');
    

// constants
var u_port = "1883";
var s_port = "8883";
var pub_topic = "iot-2/evt/sample/fmt/json";
var sub_topic_stop = "iot-2/cmd/stop/fmt/json";
var sub_topic_move = "iot-2/cmd/move/fmt/json";
var qs_org = "quickstart";
var reg_domain = ".messaging.internetofthings.ibmcloud.com";
var qs_host = "quickstart.messaging.internetofthings.ibmcloud.com";

var qs_type = "iotsample-pcduino";
var configFile = "./device.cfg";

var caCerts = ["./IoTFoundation.pem", "IoTFoundation-CA.pem"];

var CRITICAL_DIST = 15;

// globals
var qs_mode = true;
var tls = false;
var org = qs_org;
var type = qs_type;
var host = qs_host;

var stopFlag = false;

// Motor Shield Pins
var E1 = duino.Pins.GPIO4;  
var M1 = duino.Pins.GPIO5;
var E2 = duino.Pins.GPIO7;                        
var M2 = duino.Pins.GPIO6;

// Analog input Pin
var distPin  = duino.Pins.A2;
var speedPin = duino.Pins.GPIO12;

var deviceId;
var password;
var username;


function setup() {
	duino.pinMode(M1, duino.PinMode.OUTPUT);
	duino.pinMode(M2, duino.PinMode.OUTPUT);
	
	duino.pinMode(E1, duino.PinMode.OUTPUT);
	duino.pinMode(E2, duino.PinMode.OUTPUT);
	
	duino.pinMode(speedPin, duino.PinMode.INPUT);  
}

function getDistance() {
	var v = (duino.analogRead(distPin) * 3.0)/4096;
 	var inv_dist = 0.08 * v + 0.01;
 	var distance = 1.0/inv_dist - 0.42;
 	return Math.floor(distance);
}

function getSpeed() {
	var uS = duino.pulseIn( speedPin, duino.PinState.HIGH, 1000000) * 2;
	if (uS == 0)
		return 0.0;
		
	var pulsePerSec = 1000000.0/uS;
	return (pulsePerSec * Math.PI * 6.5/4.0).toFixed(1);
}

function moveForeward() {
	duino.digitalWrite(M1, duino.PinState.LOW);
  	duino.digitalWrite(M2, duino.PinState.LOW);
  	
  	duino.digitalWrite(E1, duino.PinState.HIGH);
  	duino.digitalWrite(E2, duino.PinState.HIGH);
}

function moveBackward() {
	duino.digitalWrite(M1, duino.PinState.HIGH);
  	duino.digitalWrite(M2, duino.PinState.HIGH);
  	
  	duino.digitalWrite(E1, duino.PinState.HIGH);
  	duino.digitalWrite(E2, duino.PinState.HIGH);
}

function stopMotor() {
	duino.digitalWrite(E1, duino.PinState.LOW);
  	duino.digitalWrite(E2, duino.PinState.LOW);
}

function loop(direction) {
	async.whilst(
		function() {
			return ((getDistance() > CRITICAL_DIST) && !stopFlag);
		},
		function(callback) {
			setTimeout(function() {
					if (direction == 'forward')
						moveForeward();
					else
						moveBackward();
						
					displayData(getDistance(), getSpeed())
					callback(null);
				}, 150);
		},
		function(error) {
			console.log("Done! ");
			stopMotor();
			if (getDistance() <= CRITICAL_DIST)
				process.exit(0);
		});
}

// event data object
var robotData = {};
robotData.d = {};
robotData.toJson = function() {
	return JSON.stringify(this);
};

robotData.publish = function() {
	// dont publish unless there is at least Distance data

	if (robotData.d.hasOwnProperty("dist")) {
		client.publish(pub_topic, robotData.toJson());
		console.log(pub_topic, robotData.toJson()); // trace
	}
};

function displayData(dist, speed){
	console.log("Distance is: " + dist + ", Speed is: " + speed);
	robotData.d.dist  = parseInt(dist);
	robotData.d.speed = parseFloat(speed);
}

// error report
function missing(what) {
	console.log("No " + what + " in " + configFile);
	process.exit(1);
}

// called on message received
function doCommand(topic, message, packet) {
	console.log("received command: " + topic + " msg: " + message);
	var topics = topic.split('/');
	switch(topics[2]) {
	case "move":
		stopFlag = false; 
		var payload = JSON.parse(message);
		loop(payload.direction);
		break;
	case "stop":
		stopFlag = true;
		break;
	default:
		console.log("Unxpected Command: " + topics[2]);
	}
}

//console.log("Start testing");
//var start = Date.now();

// initialize
setup();


// run functions in series
async.series([
		function(callback) {
			// read config file if any
			properties.parse(configFile, {
					path : true
				},
				function(err, config) {
					if (err && err.code != 'ENOENT')
						throw err;
					if (config) {
						org = config.org || missing('org');
						type = config.type || missing('type');
						deviceId = config.id || missing('id');
						password = config['auth-token'] || missing('auth-token');
						var method = config['auth-method'] || missing('auth-method');
						if (method != 'token') {
							console.log("unexpected auth-method = " + method);
							process.exit(1);
						}
						username = 'use-token-auth';
						host = org + reg_domain;
						tls = true;
						qs_mode = false;
					}
					callback();
				});
		},
		
		function(callback) {
			console.log('Device name = ' + "pcduino");
			robotData.d.myName = "pcduino";
			callback();
		},
		function(callback) { // connect MQTT client
			var clientId = "d:" + org + ":" + type + ":" + deviceId;
			console.log('MQTT clientId = ' + clientId);
			if (qs_mode) {
				client = mqtt.createClient(u_port, host, {
					clientId : clientId,
					keepalive : 30
				});
			} else if (tls) {
				console.log("TLS connect: " + host + ":" + s_port);
				client = mqtt.createSecureClient(s_port, host, {
						clientId : clientId,
						keepalive : 30,
						username : username,
						password : password,
						rejectUnauthorized: true,
						ca: caCerts
					});
			} else {
				console.log("Connect host: " + host + " port " + u_port);
				client = mqtt.createClient(u_port, host, {
						clientId : clientId,
						keepalive : 30,
						username : username,
						password : password
					});
			}
			client.on('connect', function() {
				// not reliable since event may fire before handler
				// installed
				console.log('MQTT Connected');
				console.log("Sending data")
				if (qs_mode) {
					console.log('MAC address = ' + deviceId);
					console.log('Go to the following link to see your device data;');
					console.log('http://quickstart.internetofthings.ibmcloud.com/#/device/' + deviceId + '/sensor/')
				}
			});
			
			client.on('error', function(err) {
				console.log('client error' + err);
				process.exit(1);
			});
			client.on('close', function() {
				console.log('client closed');
				process.exit(1);
			});
			callback();
		},
		function(callback) {
			if (!qs_mode) {
				client.subscribe(sub_topic_stop, { qos: 0 }, function(err, granted) { 
						if (err) throw err;
						console.log('Subscribed to ' + sub_topic_stop);
						//callback();
					});
				client.subscribe(sub_topic_move, { qos: 0 }, function(err, granted) { 
						if (err) throw err;
						console.log('Subscribed to ' + sub_topic_move);
						callback();
					});	
				client.on('message', doCommand);
			} else {
				callback();
			}
			
		},
		function(callback) {
			setTimeout(callback, 1000);
			setInterval(function(data) {
					data.publish();
				}, 1000, robotData);
		}
]);
