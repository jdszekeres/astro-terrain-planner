import { useEffect, useMemo, useRef, useState } from 'react'
import * as Astronomy from 'astronomy-engine'
import * as Cesium from 'cesium'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import hipStarCatalog from './assets/HIP_star.dat?raw'

import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import './App.css'

type GeoLocation = {
  latitude: number
  longitude: number
  elevationMeters: number
}

type SkyObject = {
  name: string
  altitude: number
  azimuth: number
  color: string
  size: number
}

type CatalogStar = {
  hip: number
  raHours: number
  decDeg: number
  magnitude: number
  color: string
}

const MAX_VISIBLE_MAGNITUDE = 6.5
const MIN_STAR_SIZE = 0.8
const STAR_SIZE_RANGE = 1.8
const BV_MIN = -0.4
const BV_MAX = 2.0

const PLANET_COLORS: Record<Astronomy.Body, string> = {
  [Astronomy.Body.Sun]: '#ffd37a',
  [Astronomy.Body.Moon]: '#f1f4ff',
  [Astronomy.Body.Mercury]: '#beb7ae',
  [Astronomy.Body.Venus]: '#f8c48f',
  [Astronomy.Body.Earth]: '#6aa8ff',
  [Astronomy.Body.Mars]: '#ff7d6a',
  [Astronomy.Body.Jupiter]: '#f2d0a9',
  [Astronomy.Body.Saturn]: '#f7e8bf',
  [Astronomy.Body.Uranus]: '#a8f6f3',
  [Astronomy.Body.Neptune]: '#6fa8ff',
  [Astronomy.Body.Pluto]: '#b0a292',
  [Astronomy.Body.SSB]: '#ffffff',
  [Astronomy.Body.EMB]: '#ffffff',
  [Astronomy.Body.Star1]: '#ffffff',
  [Astronomy.Body.Star2]: '#ffffff',
  [Astronomy.Body.Star3]: '#ffffff',
  [Astronomy.Body.Star4]: '#ffffff',
  [Astronomy.Body.Star5]: '#ffffff',
  [Astronomy.Body.Star6]: '#ffffff',
  [Astronomy.Body.Star7]: '#ffffff',
  [Astronomy.Body.Star8]: '#ffffff',
}

const PLANETS = [
  Astronomy.Body.Sun,
  Astronomy.Body.Moon,
  Astronomy.Body.Mercury,
  Astronomy.Body.Venus,
  Astronomy.Body.Mars,
  Astronomy.Body.Jupiter,
  Astronomy.Body.Saturn,
  Astronomy.Body.Uranus,
  Astronomy.Body.Neptune,
]

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function toHex(value: number) {
  return Math.round(clamp(value, 0, 255))
    .toString(16)
    .padStart(2, '0')
}

function bvToColorHex(bv: number) {
  // Approximate B-V index to color using Tanner Helland's color-temperature fit.
  // https://tannerhelland.com/2012/09/18/convert-temperature-rgb-algorithm-code.html
  const temperature = 4600 * ((1 / (0.92 * bv + 1.7)) + 1 / (0.92 * bv + 0.62))
  const temp = temperature / 100

  const red =
    temp <= 66 ? 255 : 329.698727446 * Math.pow(temp - 60, -0.1332047592)
  const green =
    temp <= 66
      ? 99.4708025861 * Math.log(temp) - 161.1195681661
      : 288.1221695283 * Math.pow(temp - 60, -0.0755148492)
  const blue =
    temp >= 66 ? 255 : temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307

  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`
}

function parseHipStarCatalog(rawCatalog: string): CatalogStar[] {
  return rawCatalog
    .trim()
    .split('\n')
    .slice(1)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 9)
    .map((parts) => ({
      hip: Number(parts[0]),
      magnitude: Number(parts[1]),
      raDeg: Number(parts[2]),
      decDeg: Number(parts[3]),
      bv: Number(parts[8]),
    }))
    .filter(
      (star) =>
        Number.isFinite(star.hip) &&
        Number.isFinite(star.magnitude) &&
        Number.isFinite(star.raDeg) &&
        Number.isFinite(star.decDeg) &&
        star.magnitude <= MAX_VISIBLE_MAGNITUDE,
    )
    .map((star) => ({
      hip: star.hip,
      raHours: star.raDeg / 15,
      decDeg: star.decDeg,
      magnitude: star.magnitude,
      color: Number.isFinite(star.bv) ? bvToColorHex(clamp(star.bv, BV_MIN, BV_MAX)) : '#ffffff',
    }))
}

function sizeFromMagnitude(magnitude: number) {
  const normalized = clamp((MAX_VISIBLE_MAGNITUDE - magnitude) / 7, 0.1, 1)
  return MIN_STAR_SIZE + normalized * STAR_SIZE_RANGE
}

const CATALOG_STARS = parseHipStarCatalog(hipStarCatalog)

function mergeMarkerIconUrls() {
  if (typeof window === 'undefined') {
    return
  }

  L.Icon.Default.mergeOptions({
    iconRetinaUrl: new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).toString(),
    iconUrl: new URL('leaflet/dist/images/marker-icon.png', import.meta.url).toString(),
    shadowUrl: new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).toString(),
  })
}

mergeMarkerIconUrls()

function toScenePosition(altitudeDeg: number, azimuthDeg: number, radius: number) {
  const altitude = THREE.MathUtils.degToRad(altitudeDeg)
  const azimuth = THREE.MathUtils.degToRad(azimuthDeg)
  const horizontal = Math.cos(altitude) * radius

  return new THREE.Vector3(
    Math.sin(azimuth) * horizontal,
    Math.sin(altitude) * radius,
    Math.cos(azimuth) * horizontal,
  )
}

function destinationPoint(
  latitudeDeg: number,
  longitudeDeg: number,
  bearingDeg: number,
  distanceMeters: number,
) {
  const earthRadiusMeters = 6_371_000
  const latitude = THREE.MathUtils.degToRad(latitudeDeg)
  const longitude = THREE.MathUtils.degToRad(longitudeDeg)
  const bearing = THREE.MathUtils.degToRad(bearingDeg)
  const angularDistance = distanceMeters / earthRadiusMeters

  const lat2 = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
      Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  )
  const lon2 =
    longitude +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(lat2),
    )

  return {
    latitude: THREE.MathUtils.radToDeg(lat2),
    longitude: THREE.MathUtils.radToDeg(lon2),
  }
}

function buildSkyObjects(location: GeoLocation, date: Date): SkyObject[] {
  const observer = new Astronomy.Observer(
    location.latitude,
    location.longitude,
    location.elevationMeters,
  )

  const planetObjects = PLANETS.map((body) => {
    const equatorial = Astronomy.Equator(body, date, observer, true, true)
    const horizon = Astronomy.Horizon(date, observer, equatorial.ra, equatorial.dec, 'normal')

    return {
      name: body,
      altitude: horizon.altitude,
      azimuth: horizon.azimuth,
      color: PLANET_COLORS[body],
      size: body === Astronomy.Body.Moon || body === Astronomy.Body.Sun ? 2.8 : 1.8,
    }
  })

  const starObjects = CATALOG_STARS.map((star) => {
    const horizon = Astronomy.Horizon(date, observer, star.raHours, star.decDeg, 'normal')

    return {
      name: `HIP ${star.hip}`,
      altitude: horizon.altitude,
      azimuth: horizon.azimuth,
      color: star.color,
      size: sizeFromMagnitude(star.magnitude),
    }
  })

  return [...planetObjects, ...starObjects].filter((obj) => obj.altitude > -5)
}

async function fetchTerrainHeights(location: GeoLocation): Promise<number[]> {
  const token = import.meta.env.VITE_CESIUM_ION_TOKEN
  if (!token) {
    throw new Error(
      'Set VITE_CESIUM_ION_TOKEN to load Cesium World Terrain. Falling back to generated terrain.',
    )
  }

  Cesium.Ion.defaultAccessToken = token
  const terrainProvider = await Cesium.createWorldTerrainAsync()
  const sampleCount = 72
  const sampleDistanceMeters = 8_000

  const positions = Array.from({ length: sampleCount }, (_, index) => {
    const bearing = (index / sampleCount) * 360
    const samplePoint = destinationPoint(
      location.latitude,
      location.longitude,
      bearing,
      sampleDistanceMeters,
    )

    return Cesium.Cartographic.fromDegrees(samplePoint.longitude, samplePoint.latitude)
  })

  const samples = await Cesium.sampleTerrainMostDetailed(terrainProvider, positions)
  return samples.map((sample) => sample.height ?? location.elevationMeters)
}

function toDateTimeLocalValue(value: Date) {
  const localTime = new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
  return localTime.toISOString().slice(0, 16)
}

function LocationPicker({
  location,
  onLocationChange,
}: {
  location: GeoLocation
  onLocationChange: (latitude: number, longitude: number) => void
}) {
  useMapEvents({
    click(event) {
      onLocationChange(event.latlng.lat, event.latlng.lng)
    },
  })

  return (
    <Marker
      draggable
      position={[location.latitude, location.longitude]}
      eventHandlers={{
        dragend(event) {
          const marker = event.target as L.Marker
          const position = marker.getLatLng()
          onLocationChange(position.lat, position.lng)
        },
      }}
    />
  )
}

function MapViewSync({ location }: { location: GeoLocation }) {
  const map = useMap()

  useEffect(() => {
    map.setView([location.latitude, location.longitude], map.getZoom())
  }, [location.latitude, location.longitude, map])

  return null
}

function App() {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const [location, setLocation] = useState<GeoLocation>({
    latitude: 40.7128,
    longitude: -74.006,
    elevationMeters: 10,
  })
  const [terrainHeights, setTerrainHeights] = useState<number[] | null>(null)
  const [terrainStatus, setTerrainStatus] = useState('Sampling Cesium World Terrain...')
  const [time, setTime] = useState(() => new Date())
  const [timeInput, setTimeInput] = useState(() => toDateTimeLocalValue(new Date()))
  const [isLiveTime, setIsLiveTime] = useState(true)

  const updateLocation = (latitude: number, longitude: number) => {
    setTerrainStatus('Sampling Cesium World Terrain...')
    setLocation((previous) => ({
      ...previous,
      latitude,
      longitude,
    }))
  }

  useEffect(() => {
    if (!navigator.geolocation) {
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        updateLocation(position.coords.latitude, position.coords.longitude)
        setLocation((previous) => ({
          ...previous,
          elevationMeters: position.coords.altitude ?? previous.elevationMeters,
        }))
      },
      () => {
        setTerrainStatus('Using default location. Allow geolocation for automatic positioning.')
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  }, [])

  useEffect(() => {
    if (!isLiveTime) {
      return
    }

    const intervalId = window.setInterval(() => {
      const now = new Date()
      setTime(now)
      setTimeInput(toDateTimeLocalValue(now))
    }, 1_000)

    return () => window.clearInterval(intervalId)
  }, [isLiveTime])

  useEffect(() => {
    let isMounted = true

    fetchTerrainHeights(location)
      .then((heights) => {
        if (!isMounted) {
          return
        }
        setTerrainHeights(heights)
        setTerrainStatus('Cesium World Terrain loaded')
      })
      .catch(() => {
        if (!isMounted) {
          return
        }

        const fallback = Array.from({ length: 72 }, (_, index) => {
          const ridge = Math.sin(index * 0.41) * 140
          const valley = Math.cos(index * 0.77) * 80
          return location.elevationMeters + ridge + valley
        })

        setTerrainHeights(fallback)
        setTerrainStatus('Cesium token unavailable: showing local fallback terrain silhouette')
      })

    return () => {
      isMounted = false
    }
  }, [location])

  const skyObjects = useMemo(() => buildSkyObjects(location, time), [location, time])

  useEffect(() => {
    const mountElement = mountRef.current
    if (!mountElement || !terrainHeights) {
      return
    }

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(
      68,
      mountElement.clientWidth / mountElement.clientHeight,
      0.1,
      2_000,
    )
    camera.position.set(0, 0, 0.01)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(mountElement.clientWidth, mountElement.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mountElement.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enablePan = false
    controls.enableZoom = false
    controls.enableDamping = true
    controls.rotateSpeed = 0.4
    controls.maxPolarAngle = Math.PI - 0.15
    controls.minPolarAngle = 0.15

    const skySphere = new THREE.Mesh(
      new THREE.SphereGeometry(700, 64, 48),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {
          topColor: { value: new THREE.Color('#05091b') },
          horizonColor: { value: new THREE.Color('#1a1f34') },
          nadirColor: { value: new THREE.Color('#080a10') },
        },
        vertexShader: `
          varying vec3 vWorldPosition;
          void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 topColor;
          uniform vec3 horizonColor;
          uniform vec3 nadirColor;
          varying vec3 vWorldPosition;
          void main() {
            float h = normalize(vWorldPosition).y * 0.5 + 0.5;
            vec3 sky = mix(nadirColor, horizonColor, smoothstep(0.0, 0.45, h));
            sky = mix(sky, topColor, smoothstep(0.45, 1.0, h));
            gl_FragColor = vec4(sky, 1.0);
          }
        `,
      }),
    )
    scene.add(skySphere)

    const terrainStrip: number[] = []
    const terrainIndices: number[] = []
    const ringRadius = 150
    const innerRadius = 95
    const verticalScale = 0.025
    const segments = terrainHeights.length

    for (let index = 0; index <= segments; index += 1) {
      const wrapped = index % segments
      const angle = (wrapped / segments) * Math.PI * 2
      const height =
        (terrainHeights[wrapped] - location.elevationMeters) * verticalScale - 14

      const outerX = Math.sin(angle) * ringRadius
      const outerZ = Math.cos(angle) * ringRadius
      const innerX = Math.sin(angle) * innerRadius
      const innerZ = Math.cos(angle) * innerRadius

      terrainStrip.push(outerX, height, outerZ, innerX, -20, innerZ)
      if (index < segments) {
        const base = index * 2
        terrainIndices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
      }
    }

    const terrainGeometry = new THREE.BufferGeometry()
    terrainGeometry.setAttribute('position', new THREE.Float32BufferAttribute(terrainStrip, 3))
    terrainGeometry.setIndex(terrainIndices)
    terrainGeometry.computeVertexNormals()
    const terrainMesh = new THREE.Mesh(
      terrainGeometry,
      new THREE.MeshStandardMaterial({
        color: '#3f5d4e',
        roughness: 0.95,
        metalness: 0.02,
        side: THREE.DoubleSide,
      }),
    )
    scene.add(terrainMesh)

    const horizonGlow = new THREE.Mesh(
      new THREE.RingGeometry(innerRadius + 8, ringRadius + 12, 128),
      new THREE.MeshBasicMaterial({
        color: '#78ad99',
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
      }),
    )
    horizonGlow.rotation.x = Math.PI / 2
    horizonGlow.position.y = -18
    scene.add(horizonGlow)

    const starTextureCanvas = document.createElement('canvas')
    starTextureCanvas.width = 128
    starTextureCanvas.height = 128
    const context = starTextureCanvas.getContext('2d')
    if (context) {
      const gradient = context.createRadialGradient(64, 64, 3, 64, 64, 64)
      gradient.addColorStop(0, 'rgba(255,255,255,1)')
      gradient.addColorStop(0.25, 'rgba(255,255,255,0.92)')
      gradient.addColorStop(1, 'rgba(255,255,255,0)')
      context.fillStyle = gradient
      context.fillRect(0, 0, 128, 128)
    }
    const starTexture = new THREE.CanvasTexture(starTextureCanvas)

    skyObjects.forEach((obj) => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: starTexture,
          color: obj.color,
          transparent: true,
          depthWrite: false,
        }),
      )
      sprite.position.copy(toScenePosition(obj.altitude, obj.azimuth, 420))
      sprite.scale.setScalar(obj.size * 5.5)
      scene.add(sprite)
    })

    const hemisphereLight = new THREE.HemisphereLight('#8ba5ff', '#3b5b49', 0.45)
    scene.add(hemisphereLight)
    const directionalLight = new THREE.DirectionalLight('#e0eeff', 0.35)
    directionalLight.position.set(-1, 0.3, 1)
    scene.add(directionalLight)

    const resizeObserver = new ResizeObserver(() => {
      if (!mountRef.current) {
        return
      }
      const width = mountRef.current.clientWidth
      const height = mountRef.current.clientHeight
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    })
    resizeObserver.observe(mountElement)

    let frameId = 0
    const animate = () => {
      controls.update()
      renderer.render(scene, camera)
      frameId = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      controls.dispose()
      renderer.dispose()
      terrainGeometry.dispose()
      ;(terrainMesh.material as THREE.Material).dispose()
      ;(horizonGlow.material as THREE.Material).dispose()
      starTexture.dispose()
      mountElement.removeChild(renderer.domElement)
    }
  }, [location.elevationMeters, skyObjects, terrainHeights])

  return (
    <div className="app">
      <header className="overlay panel">
        <h1>Astro Terrain Planner</h1>
        <p>
          360° night-sky panorama using Astronomy Engine and Cesium World Terrain at your current
          location.
        </p>
        <div className="meta-grid">
          <span>
            <strong>Latitude</strong>
            {location.latitude.toFixed(4)}°
          </span>
          <span>
            <strong>Longitude</strong>
            {location.longitude.toFixed(4)}°
          </span>
          <span>
            <strong>Elevation</strong>
            {Math.round(location.elevationMeters)} m
          </span>
          <span>
            <strong>Time</strong>
            {time.toLocaleString()}
          </span>
        </div>

        <div className="time-controls">
          <label htmlFor="observation-time">Observation time</label>
          <input
            id="observation-time"
            type="datetime-local"
            value={timeInput}
            onChange={(event) => {
              const nextTime = new Date(event.target.value)
              if (Number.isNaN(nextTime.getTime())) {
                return
              }
              setIsLiveTime(false)
              setTimeInput(event.target.value)
              setTime(nextTime)
            }}
          />
          <button
            type="button"
            onClick={() => {
              const now = new Date()
              setIsLiveTime(true)
              setTime(now)
              setTimeInput(toDateTimeLocalValue(now))
            }}
          >
            Use current time
          </button>
        </div>
      </header>

      <aside className="legend panel">
        <h2>Visible Sky Objects</h2>
        <ul>
          {skyObjects.slice(0, 10).map((object) => (
            <li key={object.name}>
              <span className="swatch" style={{ backgroundColor: object.color }} />
              <span>{object.name}</span>
              <small>
                alt {object.altitude.toFixed(1)}° · az {object.azimuth.toFixed(1)}°
              </small>
            </li>
          ))}
        </ul>
        <p className="status">{terrainStatus}</p>
      </aside>

      <section className="map-panel panel">
        <h2>Location map</h2>
        <p>Click the map or drag the marker to change location.</p>
        <MapContainer
          center={[location.latitude, location.longitude]}
          zoom={9}
          scrollWheelZoom
          className="leaflet-map"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapViewSync location={location} />
          <LocationPicker location={location} onLocationChange={updateLocation} />
        </MapContainer>
      </section>

      <div className="scene" ref={mountRef} />
    </div>
  )
}

export default App
