import dataclasses


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

    properties: dict[str, str]
    """Generic properties dictionary."""


@dataclasses.dataclass
class VirtualPipe:
    """Dataclass for virtual pipes connecting input and output."""

    name: str
    """Pipe identifier/name."""

    input_device: InputDevice
    """Associated input device."""

    output_device: OutputDevice
    """Associated output device."""

    persistent: bool
    """Whether the pipe should persist across restarts."""
