import dataclasses
import enum


@dataclasses.dataclass
class OutputDevice:
    """Dataclass for output devices (mirrors PulseAudio sinks)."""

    name: str
    """Device identifier/name."""

    description: str
    """Human-readable description."""

    index: int | None
    """Optional device index (mirrors PulseAudio's index system)."""

    sample_format: str
    """Sample format (e.g., 's16le' for signed 16-bit little-endian)."""

    channels: int
    """Number of audio channels (e.g., 2 for stereo)."""

    sample_rate: int
    """Sample rate in Hz (e.g., 48000)."""

    mute: bool
    """Mute state."""

    volume: str
    """Volume information."""

    virtual: bool
    """Whether the device is virtual (created programmatically)."""

    properties: dict[str, str]
    """Generic properties dictionary."""


@dataclasses.dataclass
class InputDevice:
    """Dataclass for input devices (mirrors PulseAudio sources)."""

    name: str
    """Device identifier/name."""

    description: str
    """Human-readable description."""

    index: int | None
    """Optional device index (mirrors PulseAudio's index system)."""

    sample_format: str
    """Sample format (e.g., 's16le' for signed 16-bit little-endian)."""

    channels: int
    """Number of audio channels (e.g., 2 for stereo)."""

    sample_rate: int
    """Sample rate in Hz (e.g., 48000)."""

    mute: bool
    """Mute state."""

    volume: str
    """Volume information."""

    virtual: bool
    """Whether the device is virtual (created programmatically)."""

    properties: dict[str, str]
    """Generic properties dictionary."""


class PipeType(str, enum.Enum):
    """Type of virtual pipe."""

    INPUT = "input"
    """Input pipe (acts as microphone)."""

    OUTPUT = "output"
    """Output pipe (acts as speaker)."""


@dataclasses.dataclass
class VirtualPipe:
    """Dataclass for virtual pipes (null sink with monitor source and remapped source)."""

    name: str
    """Pipe identifier/name."""

    type: PipeType
    """Type of pipe (input or output)."""

    sink: OutputDevice
    """The null sink device."""

    monitor: InputDevice
    """The monitor source of the sink."""

    source: InputDevice
    """The remapped source device (acts as microphone for input, speaker for output)."""

    persistent: bool
    """Whether the pipe should persist across restarts."""
