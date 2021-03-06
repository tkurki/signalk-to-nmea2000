const Bacon = require('baconjs');
const debug = require('debug')('signalk-to-nmea2000')
const util = require('util')

module.exports = function(app) {
  var plugin = {};
  var unsubscribes = []
  var timer
  
  plugin.id = "sk-to-nmea2000"
  plugin.name = "Convert Signal K to NMEA2000"
  plugin.description = "Plugin to convert Signal K to NMEA2000"

  plugin.schema = {
    type: "object",
    title: "Conversions to NMEA2000",
    description: "If there is SK data for the conversion generate the following NMEA2000 pgns from Signal K data:",
    properties: {
      WIND: {
        type: "boolean",
        default: false
      },
      GPS_LOCATION: {
        type: "boolean",
        default: false
      },
      SYSTEM_TIME: {
        type: "boolean",
        default: false
      }
    }
  }
  plugin.start = function(options) {
    debug("signalk-to-nmea2000: start")
    const selfContext = 'vessels.' + app.selfId
    const selfMatcher = (delta) => delta.context && delta.context === selfContext

    function mapToNmea(encoder) {
      const selfStreams = encoder.keys.map(app.streambundle.getSelfStream, app.streambundle)
      unsubscribes.push(Bacon.combineWith(encoder.f, selfStreams).changes().debounceImmediate(20).onValue(nmeaString => {
        if ( nmeaString )
        {
          debug("emit: " + nmeaString)
          app.emit('nmea2000out', nmeaString)
        }
      }))
    }

    if (options.WIND) {
      mapToNmea(WIND);
    }
    if (options.GPS_LOCATION) {
      mapToNmea(GPS_LOCATION);
    }
    if ( options.SYSTEM_TIME ) {
      timer = setInterval(send_date, 1000, app)
    }
  }

  plugin.stop = function() {
    unsubscribes.forEach(f => f())
    unsubscribes = []
    if ( timer )
    {
      clearTimeout(timer)
      timer = null
    }
  }

  return plugin
}

function padd(n, p, c)
{
  var pad_char = typeof c !== 'undefined' ? c : '0';
  var pad = new Array(1 + p).join(pad_char);
  return (pad + n).slice(-pad.length);
}

const wind_format = "%s,2,130306,1,255,8,ff,%s,%s,%s,%s,fa,ff,ff"


var WIND = {
  keys: [
    'environment.wind.angleApparent', 'environment.wind.speedApparent'
  ],
  f: function wind(angle, speed) {
    speed = speed * 100;
    angle = Math.trunc(angle * 10000)
    return util.format(wind_format, (new Date()).toISOString(),
                       padd((speed & 0xff).toString(16), 2),
                       padd(((speed >> 8) & 0xff).toString(16), 2),
                       padd((angle & 0xff).toString(16), 2),
                       padd(((angle >> 8) & 0xff).toString(16), 2));
  }
};

const location_format = "%s,7,129025,1,255,8,%s,%s,%s,%s,%s,%s,%s,%s"

var GPS_LOCATION = {
  keys: [
    'navigation.position'
  ],
  f: function location(pos) {
    var lat = pos.latitude * 10000000
    var lon = pos.longitude * 10000000
    return util.format(location_format, (new Date()).toISOString(),
                       padd((lat & 0xff).toString(16), 2),
                       padd(((lat >> 8) & 0xff).toString(16), 2),
                       padd(((lat >> 16) & 0xff).toString(16), 2),
                       padd(((lat >> 24) & 0xff).toString(16), 2),
                       padd((lon & 0xff).toString(16), 2),
                       padd(((lon >> 8) & 0xff).toString(16), 2),
                       padd(((lon >> 16) & 0xff).toString(16), 2),
                       padd(((lon >> 24) & 0xff).toString(16), 2))
  }
};


const system_time_format = "%s,3,126992,1,255,8,ff,ff,%s,%s,%s,%s,%s,%s"

function send_date(app) {
  var dateObj = new Date()
  var date = Math.trunc((dateObj.getTime() / 86400)/1000);
  var time = (dateObj.getUTCHours() * (60*60)) + (dateObj.getUTCMinutes() * 60) + dateObj.getUTCSeconds();
  time = time * 10000;
  msg = util.format(system_time_format, (new Date()).toISOString(),
                    padd((date & 0xff).toString(16), 2),
                    padd(((date >> 8) & 0xff).toString(16), 2),
                    padd((time & 0xff).toString(16), 2),
                    padd(((time >> 8) & 0xff).toString(16), 2),
                    padd(((time >> 16) & 0xff).toString(16), 2),
                    padd(((time >> 24) & 0xff).toString(16), 2))
  debug("system time: " + msg)
  app.emit('nmea2000out', msg)
}

