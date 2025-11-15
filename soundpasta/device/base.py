import abc
import typing

from soundpasta.device.models import InputDevice, OutputDevice, VirtualPipe


class DeviceManager(abc.ABC):
    """Abstract base class for device management."""

    @abc.abstractmethod
    def list_outputs(self) -> list[OutputDevice]:
        """List all output devices."""
        ...

    @abc.abstractmethod
    def list_inputs(self) -> list[InputDevice]:
        """List all input devices."""
        ...

    @abc.abstractmethod
    def list_pipes(self) -> list[VirtualPipe]:
        """List all virtual pipes."""
        ...

    @abc.abstractmethod
    def create_pipe(self, name: str, input_device: InputDevice, output_device: OutputDevice) -> VirtualPipe:
        """Create a virtual pipe."""
        ...

    @abc.abstractmethod
    def remove_pipe(self, name: str) -> None:
        """Remove a virtual pipe."""
        ...

    @abc.abstractmethod
    def play(self, device: OutputDevice, audio_data: typing.IO[bytes], raw: bool) -> None:
        """Play audio from the IO stream to the specified output device."""
        ...

    @abc.abstractmethod
    def record(self, device: InputDevice, audio_data: typing.IO[bytes], duration: float, raw: bool) -> None:
        """Record audio from the specified input device to the IO stream for the given duration."""
        ...
