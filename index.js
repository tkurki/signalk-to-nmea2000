const Bacon = require('baconjs')
const debug = require('debug')('signalk:signalk-to-nmea2000')
const util = require('util')
const toPgn = require('to-n2k').toPgn

module.exports = function (app) {
  var plugin = {}
  var unsubscribes = []
  var timer

  plugin.id = 'sk-to-nmea2000'
  plugin.name = 'Convert Signal K to NMEA2000'
  plugin.description = 'Plugin to convert Signal K to NMEA2000'

  plugin.schema = {
    type: 'object',
    title: 'Conversions to NMEA2000',
    description: 'If there is SK data for the conversion generate the following NMEA2000 pgns from Signal K data:',
    properties: {
      WIND: {
        title: '130306 Wind',
        type: 'boolean',
        default: false
      },
      GPS_LOCATION: {
        title: '129025 Location',
        type: 'boolean',
        default: false
      },
      SYSTEM_TIME: {
        title: '126992 System Time',
        type: 'boolean',
        default: false
      },
      HEADING: {
        title: '127250 Heading',
        type: 'boolean',
        default: false
      },
      BATTERYSTATUS: {
        title: '127508 Battery status',
        type: 'array',
        items: {
          type: 'object',
          properties: {
            signalkId: {
              type: 'string',
              title: 'Signal K battery id'
            },
            instanceId: {
              type: 'number',
              title: 'NMEA2000 Battery Instance Id'
            }
          }
        }
      }
    }
  }

  function activateFastformat (encoder) {
    unsubscribes.push(
      timeoutingArrayStream(
        encoder.keys,
        encoder.timeouts,
        app.streambundle,
        unsubscribes
      )
        .map(values => encoder.f.call(this, ...values))
        .onValue(pgn => {
          if (pgn) {
            debug('emit: ' + pgn)
            app.emit('nmea2000out', pgn)
          }
        })
    )
  }

  function activatePgn (encoder) {
    unsubscribes.push(
      timeoutingArrayStream(
        encoder.keys,
        encoder.timeouts,
        app.streambundle,
        unsubscribes
      )
        .map(values => encoder.f.call(this, ...values))
        .map(toPgn)
        .onValue(pgnData => {
          if (pgnData) {
            const msg = toActisenseSerialFormat(encoder.pgn, pgnData)
            debug('emit:' + msg)
            app.emit('nmea2000out', msg)
          }
        })
    )
  }

  plugin.start = function (options) {
    debug('start')
    const selfContext = 'vessels.' + app.selfId
    const selfMatcher = delta => delta.context && delta.context === selfContext

    if (options.WIND) {
      activateFastformat(WIND, app.streambundle)
    }
    if (options.GPS_LOCATION) {
      activateFastformat(GPS_LOCATION, app.streambundle)
    }
    if (options.SYSTEM_TIME) {
      const timer = setInterval(send_date, 1000, app)
      unsubscribes.push(() => {
        clearTimeout(timer)
      })
    }
    if (options.HEADING) {
      activatePgn(HEADING_127250, app.streambundle)
    }
    if (options.BATTERYSTATUS) {
      console.log(options.BATTERYSTATUS)
      options.BATTERYSTATUS.map(BATTERY_STATUS_127508).forEach(encoder => {
        activatePgn(encoder, app.streambundle)
      })
    }
  }

  plugin.stop = function () {
    unsubscribes.forEach(f => f())
    unsubscribes = []
  }

  return plugin
}

function padd (n, p, c) {
  var pad_char = typeof c !== 'undefined' ? c : '0'
  var pad = new Array(1 + p).join(pad_char)
  return (pad + n).slice(-pad.length)
}

const wind_format = '%s,2,130306,1,255,8,ff,%s,%s,%s,%s,fa,ff,ff'

var WIND = {
  keys: ['environment.wind.angleApparent', 'environment.wind.speedApparent'],
  f: function wind (angle, speed) {
    speed = speed * 100
    angle = Math.trunc(angle * 10000)
    return util.format(
      wind_format,
      new Date().toISOString(),
      padd((speed & 0xff).toString(16), 2),
      padd(((speed >> 8) & 0xff).toString(16), 2),
      padd((angle & 0xff).toString(16), 2),
      padd(((angle >> 8) & 0xff).toString(16), 2)
    )
  }
}

const location_format = '%s,7,129025,1,255,8,%s,%s,%s,%s,%s,%s,%s,%s'

var GPS_LOCATION = {
  keys: ['navigation.position'],
  f: function location (pos) {
    var lat = pos.latitude * 10000000
    var lon = pos.longitude * 10000000
    return util.format(
      location_format,
      new Date().toISOString(),
      padd((lat & 0xff).toString(16), 2),
      padd(((lat >> 8) & 0xff).toString(16), 2),
      padd(((lat >> 16) & 0xff).toString(16), 2),
      padd(((lat >> 24) & 0xff).toString(16), 2),
      padd((lon & 0xff).toString(16), 2),
      padd(((lon >> 8) & 0xff).toString(16), 2),
      padd(((lon >> 16) & 0xff).toString(16), 2),
      padd(((lon >> 24) & 0xff).toString(16), 2)
    )
  }
}

const system_time_format = '%s,3,126992,1,255,8,ff,ff,%s,%s,%s,%s,%s,%s'

function send_date (app) {
  var dateObj = new Date()
  var date = Math.trunc(dateObj.getTime() / 86400 / 1000)
  var time =
    dateObj.getUTCHours() * (60 * 60) +
    dateObj.getUTCMinutes() * 60 +
    dateObj.getUTCSeconds()
  time = time * 10000
  msg = util.format(
    system_time_format,
    new Date().toISOString(),
    padd((date & 0xff).toString(16), 2),
    padd(((date >> 8) & 0xff).toString(16), 2),
    padd((time & 0xff).toString(16), 2),
    padd(((time >> 8) & 0xff).toString(16), 2),
    padd(((time >> 16) & 0xff).toString(16), 2),
    padd(((time >> 24) & 0xff).toString(16), 2)
  )
  debug('system time: ' + msg)
  app.emit('nmea2000out', msg)
}

const HEADING_127250 = {
  pgn: 127250,
  keys: [
    'navigation.headingMagnetic'
    // ,'navigation.magneticVariation'
  ],
  f: (heading, variation) => {
    return {
      pgn: 127250,
      SID: 87,
      Heading: heading / 180 * Math.PI,
      // "Variation": variation,
      Reference: 'Magnetic'
    }
  }
}

const BATTERY_STATUS_127508_ARG_NAMES = ['Voltage', 'Current', 'Temperature']
const BATTERY_STATUS_127508 = ({ signalkId, instanceId }) => ({
  pgn: 127508,
  keys: [
    `electrical.batteries.${signalkId}.voltage`,
    `electrical.batteries.${signalkId}.current`,
    `electrical.batteries.${signalkId}.temperature`
  ],
  timeouts: [1000, 1000, 1000],
  f: function () {
    const result = {
      pgn: 127508,
      'Battery Instance': instanceId,
      SID: 18
    }
    BATTERY_STATUS_127508_ARG_NAMES.forEach((argName, i) => {
      if (isDefined(arguments[i])) {
        result[argName] = arguments[i]
      }
    })
    return result
  }
})

function toActisenseSerialFormat (pgn, data) {
  return (
    '1970-01-01T00:00:00.000,4,' +
    pgn +
    ',43,255,' +
    data.length +
    ',' +
    new Uint32Array(data)
      .reduce(function (acc, i) {
        acc.push(i.toString(16))
        return acc
      }, [])
      .map(x => (x.length === 1 ? '0' + x : x))
      .join(',')
  )
}

function timeoutingArrayStream (
  keys,
  timeouts = [],
  streambundle,
  unsubscribes
) {
  debug(`keys:${keys}`)
  debug(`timeouts:${timeouts}`)
  const lastValues = keys.reduce((acc, key) => {
    acc[key] = {
      timestamp: new Date().getTime(),
      value: null
    }
    return acc
  }, {})
  const combinedBus = new Bacon.Bus()
  keys.map(skKey => {
    streambundle.getSelfStream(skKey).onValue(value => {
      lastValues[skKey] = {
        timestamp: new Date().getTime(),
        value
      }
      const now = new Date().getTime()

      combinedBus.push(
        keys.map((key, i) => {
          return notDefined(timeouts[i]) ||
            lastValues[key].timestamp + timeouts[i] > now
            ? lastValues[key].value
            : null
        })
      )
    })
  })
  const result = combinedBus.debounce(10)
  if (debug.enabled) {
    unsubscribes.push(result.onValue(x => debug(`${keys}:${x}`)))
  }
  return result
}

const notDefined = x => typeof x === 'undefined'
const isDefined = x => typeof x !== 'undefined'
