#!/bin/sh
set -eu

host_name="${KURA_MDNS_HOSTNAME:-kura}"
service_name="${KURA_MDNS_SERVICE_NAME:-Kura}"
service_port="${KURA_MDNS_PORT:-3000}"
service_path="${KURA_MDNS_PATH:-/zh-Hans}"

xml_escape() {
  printf '%s' "$1" | sed \
    -e 's/&/\&amp;/g' \
    -e 's/</\&lt;/g' \
    -e 's/>/\&gt;/g' \
    -e "s/'/\&apos;/g" \
    -e 's/"/\&quot;/g'
}

case "$host_name" in
  *.local)
    host_name="${host_name%.local}"
    ;;
esac

if ! printf '%s' "$host_name" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$'; then
  echo "Invalid KURA_MDNS_HOSTNAME: $host_name" >&2
  exit 1
fi

if ! printf '%s' "$service_port" | grep -Eq '^[0-9]+$' || [ "$service_port" -lt 1 ] || [ "$service_port" -gt 65535 ]; then
  echo "Invalid KURA_MDNS_PORT: $service_port" >&2
  exit 1
fi

case "$service_path" in
  /*)
    ;;
  *)
    echo "Invalid KURA_MDNS_PATH: $service_path" >&2
    exit 1
    ;;
esac

if printf '%s' "${service_name}${service_path}" | grep -q '[[:cntrl:]]'; then
  echo "KURA_MDNS_SERVICE_NAME and KURA_MDNS_PATH must not contain control characters" >&2
  exit 1
fi

if [ -n "${KURA_MDNS_INTERFACE:-}" ] && ! printf '%s' "$KURA_MDNS_INTERFACE" | grep -Eq '^[A-Za-z0-9_.:-]+(,[A-Za-z0-9_.:-]+)*$'; then
  echo "Invalid KURA_MDNS_INTERFACE: $KURA_MDNS_INTERFACE" >&2
  exit 1
fi

service_name_xml="$(xml_escape "$service_name")"
service_path_xml="$(xml_escape "$service_path")"

mkdir -p /etc/avahi/services

cat >/etc/avahi/avahi-daemon.conf <<EOF
[server]
host-name=${host_name}
domain-name=local
use-ipv4=yes
use-ipv6=no
enable-dbus=no
ratelimit-interval-usec=1000000
ratelimit-burst=1000

[wide-area]
enable-wide-area=no

[publish]
disable-publishing=no
publish-addresses=yes
publish-hinfo=no
publish-workstation=no
publish-domain=no

[reflector]
enable-reflector=no
EOF

if [ -n "${KURA_MDNS_INTERFACE:-}" ]; then
  sed -i "/^use-ipv6=no/a allow-interfaces=${KURA_MDNS_INTERFACE}" /etc/avahi/avahi-daemon.conf
fi

cat >/etc/avahi/services/kura.service <<EOF
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">${service_name_xml}</name>
  <service>
    <type>_http._tcp</type>
    <port>${service_port}</port>
    <txt-record>path=${service_path_xml}</txt-record>
    <txt-record>app=Kura</txt-record>
  </service>
</service-group>
EOF

echo "Advertising ${host_name}.local for ${service_name} on _http._tcp:${service_port}${service_path}"
exec avahi-daemon --no-chroot --no-drop-root --debug
