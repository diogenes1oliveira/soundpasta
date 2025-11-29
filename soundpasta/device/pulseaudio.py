import logging
import subprocess
import typing
from pathlib import Path

from soundpasta.device.base import DeviceManager
from soundpasta.device.models import InputDevice, OutputDevice, PipeType, VirtualPipe

logger = logging.getLogger(__name__)


class PulseAudioDeviceManager(DeviceManager):
    """PulseAudio implementation of DeviceManager using pactl/pacmd subprocess calls."""

    def __init__(self, pipe_suffix: str = "-Pipe") -> None:
        """Initialize PulseAudioDeviceManager.

        Args:
            pipe_suffix: Suffix to append to pipe descriptions. Defaults to "-Pipe".
                        Note: PulseAudio property values cannot contain spaces when
                        passed via command line, so use formats like "-Pipe" instead of " (Pipe)".
        """
        self.pipe_suffix = pipe_suffix
        # Specific role suffixes for clarity in descriptions
        self._input_suffix = "-InputPipe"
        self._output_suffix = "-OutputPipe"
        self._monitor_suffix = "-MonitorPipe"
        self._pulse_config_dir = Path.home() / ".config" / "pulse"
        self._soundpasta_config_file = self._pulse_config_dir / "soundpasta.pa"
        self._default_config_file = self._pulse_config_dir / "default.pa"

    def list_outputs(self) -> list[OutputDevice]:
        """List all output devices."""
        logger.debug("Listing output devices")
        result = subprocess.run(
            ["pactl", "list", "sinks", "short"],
            capture_output=True,
            text=True,
            check=True,
        )
        sink_lines = [l for l in result.stdout.strip().split("\n") if l.strip()]
        logger.debug(f"Found {len(sink_lines)} sink lines")
        sinks = []
        for line in result.stdout.strip().split("\n"):
            if not line.strip():
                continue
            parts = line.split("\t")
            if len(parts) < 4:
                logger.debug(f"Skipping malformed sink line: {line}")
                continue
            index = int(parts[0]) if parts[0].isdigit() else None
            name = parts[1]
            logger.debug(f"Processing sink: {name} (index: {index})")
            details = self._get_sink_details(name)
            sinks.append(
                OutputDevice(
                    name=name,
                    description=details.get("description", name),
                    index=index,
                    sample_format=details.get("sample_format", "s16le"),
                    channels=details.get("channels", 2),
                    sample_rate=details.get("sample_rate", 48000),
                    mute=details.get("mute", False),
                    volume=details.get("volume", ""),
                    virtual=details.get("virtual", False),
                    properties=details.get("properties", {}),
                )
            )
        logger.info(f"Listed {len(sinks)} output devices")
        return sinks

    def list_inputs(self) -> list[InputDevice]:
        """List all input devices."""
        logger.debug("Listing input devices")
        result = subprocess.run(
            ["pactl", "list", "sources", "short"],
            capture_output=True,
            text=True,
            check=True,
        )
        source_lines = [l for l in result.stdout.strip().split("\n") if l.strip()]
        logger.debug(f"Found {len(source_lines)} source lines")
        sources = []
        for line in result.stdout.strip().split("\n"):
            if not line.strip():
                continue
            parts = line.split("\t")
            if len(parts) < 4:
                logger.debug(f"Skipping malformed source line: {line}")
                continue
            index = int(parts[0]) if parts[0].isdigit() else None
            name = parts[1]
            logger.debug(f"Processing source: {name} (index: {index})")
            details = self._get_source_details(name)
            sources.append(
                InputDevice(
                    name=name,
                    description=details.get("description", name),
                    index=index,
                    sample_format=details.get("sample_format", "s16le"),
                    channels=details.get("channels", 2),
                    sample_rate=details.get("sample_rate", 48000),
                    mute=details.get("mute", False),
                    volume=details.get("volume", ""),
                    virtual=details.get("virtual", False),
                    properties=details.get("properties", {}),
                )
            )
        logger.info(f"Listed {len(sources)} input devices")
        return sources

    def list_pipes(self) -> list[VirtualPipe]:
        """List all virtual pipes by finding monitors that link sinks and sources together."""
        logger.debug("Listing virtual pipes")
        sinks = self.list_outputs()
        sources = self.list_inputs()
        pipes = []
        sinks_by_name = {s.name: s for s in sinks}
        sources_by_name = {s.name: s for s in sources}

        for source in sources:
            monitor_name = source.name
            if not monitor_name.endswith(".monitor"):
                continue

            sink_name = monitor_name[:-8]
            monitor = source
            sink = sinks_by_name.get(sink_name)

            if not sink:
                continue

            pipe_name = None
            pipe_type = None
            remapped_source = None

            if sink_name.endswith("-pipe"):
                pipe_type = PipeType.INPUT
                pipe_name = sink_name[:-5]
                remapped_source = sources_by_name.get(pipe_name)
            else:
                pipe_type = PipeType.OUTPUT
                pipe_name = sink_name
                remapped_source_name = f"{pipe_name}-pipe"
                remapped_source = sources_by_name.get(remapped_source_name)

            if sink and monitor and remapped_source and pipe_name:
                is_persistent = self._is_pipe_in_config(pipe_name, pipe_type)
                # Append role suffixes for clarity (normalize to avoid "-pipe" in descriptions)
                sink.description = self._normalize_role_description(sink.description, self._output_suffix)
                remapped_source.description = self._normalize_role_description(
                    remapped_source.description, self._input_suffix
                )
                monitor.description = self._normalize_role_description(monitor.description, self._monitor_suffix)
                pipes.append(
                    VirtualPipe(
                        name=pipe_name,
                        type=pipe_type,
                        sink=sink,
                        monitor=monitor,
                        source=remapped_source,
                        persistent=is_persistent,
                    )
                )

        logger.info(f"Listed {len(pipes)} virtual pipes")
        return pipes

    def create_pipe(self, name: str, pipe_type: PipeType, persistent: bool = False) -> VirtualPipe:
        """Create a virtual pipe (null sink with monitor source and remapped source)."""
        logger.info(f"Creating virtual pipe '{name}' (type: {pipe_type.value})")
        if pipe_type == PipeType.INPUT:
            sink_name = f"{name}-pipe"
            source_name = name
            monitor_name = f"{sink_name}.monitor"
        elif pipe_type == PipeType.OUTPUT:
            sink_name = name
            source_name = f"{name}-pipe"
            monitor_name = f"{sink_name}.monitor"
        else:
            raise ValueError(f"Invalid pipe type: {pipe_type}")
        sink_description = f"{name}{self._output_suffix}"
        cmd = [
            "pactl",
            "load-module",
            "module-null-sink",
            f"sink_name={sink_name}",
            f"sink_properties=device.description={sink_description}",
        ]
        logger.debug(f"Running command: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        logger.debug(f"Created null sink module: {result.stdout.strip()}")
        source_description = f"{name}{self._input_suffix}"
        remap_cmd = [
            "pactl",
            "load-module",
            "module-remap-source",
            f"source_name={source_name}",
            f"master={monitor_name}",
            f"source_properties=device.description={source_description}",
        ]
        logger.debug(f"Running command: {' '.join(remap_cmd)}")
        remap_result = subprocess.run(remap_cmd, capture_output=True, text=True, check=True)
        logger.debug(f"Created remap source module: {remap_result.stdout.strip()}")
        sinks = self.list_outputs()
        sources = self.list_inputs()
        sink = next((s for s in sinks if s.name == sink_name), None)
        if not sink:
            raise RuntimeError(f"Failed to find created sink '{sink_name}'")
        monitor = next((s for s in sources if s.name == monitor_name), None)
        if not monitor:
            raise RuntimeError(f"Failed to find monitor source '{monitor_name}'")
        source = next((s for s in sources if s.name == source_name), None)
        if not source:
            raise RuntimeError(f"Failed to find remapped source '{source_name}'")
        logger.info(f"Created virtual pipe '{name}' with sink, monitor, and source")
        if persistent:
            self._write_pipe_to_config(
                name, pipe_type, sink_name, source_name, monitor_name, sink_description, source_description
            )
        # Ensure returned device descriptions carry role-specific suffixes (monitor cannot be set via pactl)
        sink.description = self._normalize_role_description(sink.description, self._output_suffix)
        monitor.description = self._normalize_role_description(monitor.description, self._monitor_suffix)
        source.description = self._normalize_role_description(source.description, self._input_suffix)
        return VirtualPipe(
            name=name,
            type=pipe_type,
            sink=sink,
            monitor=monitor,
            source=source,
            persistent=persistent,
        )

    def remove_pipe(self, name: str) -> None:
        """Remove a virtual pipe."""
        logger.info(f"Removing virtual pipe '{name}'")
        pipes = self.list_pipes()
        pipe = next((p for p in pipes if p.name == name), None)
        if not pipe:
            logger.warning(f"Pipe '{name}' not found")
            return
        if pipe.persistent:
            self._remove_pipe_from_config(name, pipe.type)
        if pipe.type == PipeType.INPUT:
            sink_name = f"{name}-pipe"
            source_name = name
        else:
            sink_name = name
            source_name = f"{name}-pipe"
        result = subprocess.run(
            ["pactl", "list", "short", "modules"],
            capture_output=True,
            text=True,
            check=True,
        )
        null_sink_module = None
        remap_source_module = None
        for line in result.stdout.strip().split("\n"):
            if not line.strip():
                continue
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            module_args = " ".join(parts[2:]) if len(parts) > 2 else ""
            if parts[1].startswith("module-null-sink") and f"sink_name={sink_name}" in module_args:
                null_sink_module = parts[0]
            elif parts[1].startswith("module-remap-source") and f"source_name={source_name}" in module_args:
                remap_source_module = parts[0]
        if remap_source_module:
            logger.debug(f"Unloading remap source module {remap_source_module}")
            subprocess.run(
                ["pactl", "unload-module", remap_source_module],
                capture_output=True,
                text=True,
                check=True,
            )
        if null_sink_module:
            logger.debug(f"Unloading null sink module {null_sink_module}")
            subprocess.run(
                ["pactl", "unload-module", null_sink_module],
                capture_output=True,
                text=True,
                check=True,
            )
        logger.info(f"Removed virtual pipe '{name}'")

    def play(self, device: OutputDevice, audio_data: typing.IO[bytes], raw: bool) -> None:
        """Play audio from the IO stream to the specified output device."""
        logger.info(f"Playing audio to device '{device.name}' (raw={raw})")
        cmd = ["paplay", "--device", device.name]
        if raw:
            cmd.extend(
                [
                    "--raw",
                    "--rate",
                    str(device.sample_rate),
                    "--channels",
                    str(device.channels),
                    "--format",
                    device.sample_format,
                ]
            )
        logger.debug(f"Running command: {' '.join(cmd)}")
        process = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        audio_data.seek(0)
        audio_bytes = audio_data.read()
        logger.debug(f"Playing {len(audio_bytes)} bytes of audio data")
        stdout, stderr = process.communicate(input=audio_bytes)
        if process.returncode != 0:
            error_msg = stderr.decode()
            logger.error(f"paplay failed: {error_msg}")
            raise RuntimeError(f"paplay failed: {error_msg}")
        logger.info(f"Successfully played audio to device '{device.name}'")

    def record(self, device: InputDevice, audio_data: typing.IO[bytes], duration: float, raw: bool) -> None:
        """Record audio from the specified input device to the IO stream for the given duration."""
        import os
        import tempfile

        logger.info(f"Recording audio from device '{device.name}' for {duration}s (raw={raw})")
        with tempfile.NamedTemporaryFile(suffix=".wav" if not raw else ".raw", delete=False) as tmp_file:
            tmp_path = tmp_file.name
        cmd = ["parecord", "--device", device.name]
        if raw:
            cmd.extend(
                [
                    "--raw",
                    "--rate",
                    str(device.sample_rate),
                    "--channels",
                    str(device.channels),
                    "--format",
                    device.sample_format,
                    tmp_path,
                ]
            )
        else:
            cmd.extend(["--file-format=wav", tmp_path])
        logger.debug(f"Running command: {' '.join(cmd)}")
        process = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        try:
            logger.debug(f"Waiting for recording to complete (timeout: {duration}s)")
            process.wait(timeout=duration)
        except subprocess.TimeoutExpired:
            logger.debug("Recording timeout expired, terminating process")
            process.terminate()
            process.wait()
        if process.returncode not in (0, -15):
            stderr = process.stderr.read().decode() if process.stderr else ""
            logger.error(f"parecord failed: {stderr}")
            raise RuntimeError(f"parecord failed: {stderr}")
        with open(tmp_path, "rb") as f:
            recorded_bytes = f.read()
            logger.debug(f"Recorded {len(recorded_bytes)} bytes")
            audio_data.write(recorded_bytes)
        os.unlink(tmp_path)
        logger.info(f"Successfully recorded audio from device '{device.name}'")

    def _get_sink_details(self, name: str) -> dict[str, typing.Any]:
        """Get detailed information about a sink."""
        logger.debug(f"Getting details for sink: {name}")
        result = subprocess.run(
            ["pactl", "list", "sinks"],
            capture_output=True,
            text=True,
            check=True,
        )
        details = self._parse_device_details(result.stdout, name)
        logger.debug(f"Sink '{name}' details: {details}")
        return details

    def _get_source_details(self, name: str) -> dict[str, typing.Any]:
        """Get detailed information about a source."""
        logger.debug(f"Getting details for source: {name}")
        result = subprocess.run(
            ["pactl", "list", "sources"],
            capture_output=True,
            text=True,
            check=True,
        )
        details = self._parse_device_details(result.stdout, name)
        logger.debug(f"Source '{name}' details: {details}")
        return details

    def _parse_device_details(self, output: str, name: str) -> dict[str, typing.Any]:
        """Parse device details from pactl output."""
        details: dict[str, typing.Any] = {
            "description": name,
            "sample_format": "s16le",
            "channels": 2,
            "sample_rate": 48000,
            "mute": False,
            "volume": "",
            "virtual": False,
            "properties": {},
        }
        in_device = False
        in_properties = False
        current_properties: dict[str, str] = {}
        owner_module = None
        driver = None
        for line in output.split("\n"):
            line = line.rstrip()
            if line.startswith("Sink #") or line.startswith("Source #"):
                in_device = False
                in_properties = False
            if f"Name: {name}" in line:
                in_device = True
                continue
            if not in_device:
                continue
            if line.startswith("\tName:"):
                if line.split(":", 1)[1].strip() != name:
                    in_device = False
                    continue
            if line.startswith("\tDescription:"):
                details["description"] = line.split(":", 1)[1].strip()
            elif line.startswith("\tDriver:"):
                driver = line.split(":", 1)[1].strip()
            elif line.startswith("\tOwner Module:"):
                owner_module = line.split(":", 1)[1].strip()
            elif line.startswith("\tSample Specification:"):
                spec = line.split(":", 1)[1].strip()
                parts = spec.split()
                if parts:
                    details["sample_format"] = parts[0]
                    for part in parts[1:]:
                        if part.endswith("ch"):
                            details["channels"] = int(part[:-2])
                        elif part.endswith("Hz"):
                            details["sample_rate"] = int(part[:-2])
            elif line.startswith("\tMute:"):
                details["mute"] = line.split(":", 1)[1].strip().lower() == "yes"
            elif line.startswith("\tVolume:"):
                details["volume"] = line.split(":", 1)[1].strip()
            elif line.startswith("\tProperties:"):
                in_properties = True
                current_properties = {}
            elif in_properties:
                if line.startswith("\t\t"):
                    prop_line = line.strip()
                    if "=" in prop_line:
                        key, value = prop_line.split("=", 1)
                        current_properties[key.strip()] = value.strip().strip('"')
                elif line.startswith("\t") and not line.startswith("\t\t"):
                    in_properties = False
                    details["properties"] = current_properties
            elif line.startswith("\t") and not line.startswith("\t\t"):
                in_properties = False
        if in_properties:
            details["properties"] = current_properties
        is_virtual = (
            "null" in name.lower()
            or (driver and "null" in driver.lower())
            or (owner_module and owner_module != "n/a" and "null" in owner_module.lower())
        )
        details["virtual"] = is_virtual
        return details

    def _ensure_role_suffix(self, description: str, suffix: str) -> str:
        """Append or normalize a role-specific suffix in a description string."""
        if description.endswith(suffix):
            return description
        if self.pipe_suffix and description.endswith(self.pipe_suffix):
            return f"{description[: -len(self.pipe_suffix)]}{suffix}"
        # If description includes '-pipe' suffix, drop it before appending desired role suffix
        if description.endswith("-pipe"):
            base = description[: -len("-pipe")]
            return f"{base}{suffix}"
        return f"{description}{suffix}"

    def _normalize_role_description(self, description: str, suffix: str) -> str:
        """Normalize description to base name + desired role suffix, stripping existing role or '-pipe' suffixes."""
        base = description
        # Strip known role suffixes
        for s in (self._input_suffix, self._output_suffix, self._monitor_suffix):
            if base.endswith(s):
                base = base[: -len(s)]
                break
        # Strip generic configured pipe suffix
        if self.pipe_suffix and base.endswith(self.pipe_suffix):
            base = base[: -len(self.pipe_suffix)]
        # Strip '-pipe' if present
        if base.endswith("-pipe"):
            base = base[: -len("-pipe")]
        return f"{base}{suffix}"

    def _ensure_config_include(self) -> None:
        """Ensure .include soundpasta.pa exists in default.pa."""
        if not self._default_config_file.exists():
            self._pulse_config_dir.mkdir(parents=True, exist_ok=True)
            with open(self._default_config_file, "w") as f:
                f.write(".include soundpasta.pa\n")
            logger.debug(f"Created default.pa with include directive")
            return

        with open(self._default_config_file, "r") as f:
            content = f.read()

        include_line = ".include soundpasta.pa"
        if include_line not in content:
            with open(self._default_config_file, "a") as f:
                f.write(f"\n{include_line}\n")
            logger.debug(f"Added include directive to default.pa")

    def _write_pipe_to_config(
        self,
        name: str,
        pipe_type: PipeType,
        sink_name: str,
        source_name: str,
        monitor_name: str,
        sink_description: str,
        source_description: str,
    ) -> None:
        """Write pipe module-load commands to soundpasta.pa config file."""
        self._ensure_config_include()
        self._pulse_config_dir.mkdir(parents=True, exist_ok=True)

        null_sink_line = (
            f"load-module module-null-sink sink_name={sink_name} sink_properties=device.description={sink_description}"
        )
        remap_source_line = f"load-module module-remap-source source_name={source_name} master={monitor_name} source_properties=device.description={source_description}"

        if self._soundpasta_config_file.exists():
            with open(self._soundpasta_config_file, "r") as f:
                content = f.read()
            if sink_name in content and source_name in content:
                logger.debug(f"Pipe '{name}' already in config file, skipping")
                return
        else:
            content = ""

        with open(self._soundpasta_config_file, "a") as f:
            if content and not content.endswith("\n"):
                f.write("\n")
            f.write(f"# Soundpasta pipe: {name} ({pipe_type.value})\n")
            f.write(f"{null_sink_line}\n")
            f.write(f"{remap_source_line}\n")
        logger.info(f"Wrote pipe '{name}' to config file")

    def _remove_pipe_from_config(self, name: str, pipe_type: PipeType) -> None:
        """Remove pipe module-load commands from soundpasta.pa config file."""
        if not self._soundpasta_config_file.exists():
            return

        if pipe_type == PipeType.INPUT:
            sink_name = f"{name}-pipe"
            source_name = name
        else:
            sink_name = name
            source_name = f"{name}-pipe"

        with open(self._soundpasta_config_file, "r") as f:
            lines = f.readlines()

        new_lines = []
        skip_next = 0
        for i, line in enumerate(lines):
            if skip_next > 0:
                skip_next -= 1
                continue
            if f"# Soundpasta pipe: {name}" in line:
                skip_next = 2
                continue
            if sink_name in line and "module-null-sink" in line:
                continue
            if source_name in line and "module-remap-source" in line:
                continue
            new_lines.append(line)

        with open(self._soundpasta_config_file, "w") as f:
            f.writelines(new_lines)
        logger.info(f"Removed pipe '{name}' from config file")

    def _is_pipe_in_config(self, name: str, pipe_type: PipeType) -> bool:
        """Check if pipe exists in soundpasta.pa config file."""
        if not self._soundpasta_config_file.exists():
            return False

        if pipe_type == PipeType.INPUT:
            sink_name = f"{name}-pipe"
            source_name = name
        else:
            sink_name = name
            source_name = f"{name}-pipe"

        with open(self._soundpasta_config_file, "r") as f:
            content = f.read()

        return sink_name in content and source_name in content and f"# Soundpasta pipe: {name}" in content
