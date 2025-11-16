import io
import typing

import click
from tabulate import tabulate

from soundpasta.device.base import DeviceManager
from soundpasta.device.models import PipeType
from soundpasta.device.pulseaudio import PulseAudioDeviceManager


@click.group()
@click.pass_context
def device(ctx: click.Context) -> None:
    """Device management commands."""
    ctx.obj = PulseAudioDeviceManager()


@device.group()
@click.pass_obj
def input(obj: DeviceManager) -> None:
    """Input device commands."""
    pass


@input.command("list")
@click.option("--quiet", is_flag=True, help="Output only device names")
@click.pass_obj
def input_list(obj: DeviceManager, quiet: bool) -> None:
    """List available input devices."""
    devices = obj.list_inputs()
    if quiet:
        for device in devices:
            click.echo(device.name)
    else:
        headers = ["Name", "Description", "Index", "Format", "Channels", "Sample Rate", "Mute", "Volume", "Virtual"]
        rows = [
            [
                device.name,
                device.description,
                device.index if device.index is not None else "",
                device.sample_format,
                device.channels,
                device.sample_rate,
                device.mute,
                device.volume,
                device.virtual,
            ]
            for device in devices
        ]
        click.echo(tabulate(rows, headers=headers, tablefmt="plain"))


@input.command("create")
@click.argument("name")
@click.option("--persistent/--no-persistent", default=False, help="Make the device persistent")
@click.pass_obj
def input_create(obj: DeviceManager, name: str, persistent: bool) -> None:
    """Create a virtual input device."""
    pipe = obj.create_pipe(name, PipeType.INPUT, persistent=persistent)
    click.echo(f"Created input device '{pipe.name}' (persistent={pipe.persistent})", err=True)


@input.command("remove")
@click.argument("name")
@click.pass_obj
def input_remove(obj: DeviceManager, name: str) -> None:
    """Remove a virtual input device."""
    click.echo(f"Removing input device '{name}'", err=True)
    # TODO: Implement when DeviceManager has remove_input method


@input.command("record")
@click.argument("device_name")
@click.argument("output_file", type=click.Path())
@click.argument("duration", type=float)
@click.option("--raw/--no-raw", default=False, help="Record as raw PCM data")
@click.pass_obj
def input_record(obj: DeviceManager, device_name: str, output_file: str, duration: float, raw: bool) -> None:
    """Record audio from the specified input device to a file."""
    devices = obj.list_inputs()
    device = next((d for d in devices if d.name == device_name), None)
    if not device:
        click.echo(f"Input device '{device_name}' not found", err=True)
        raise click.Abort()

    recorded_data = io.BytesIO()
    obj.record(device, recorded_data, duration, raw=raw)
    recorded_data.seek(0)
    with open(output_file, "wb") as f:
        f.write(recorded_data.read())
    click.echo(f"Recorded audio from device '{device_name}' to '{output_file}'", err=True)


@device.group()
@click.pass_obj
def output(obj: DeviceManager) -> None:
    """Output device commands."""
    pass


@output.command("list")
@click.option("--quiet", is_flag=True, help="Output only device names")
@click.pass_obj
def output_list(obj: DeviceManager, quiet: bool) -> None:
    """List available output devices."""
    devices = obj.list_outputs()
    if quiet:
        for device in devices:
            click.echo(device.name)
    else:
        headers = ["Name", "Description", "Index", "Format", "Channels", "Sample Rate", "Mute", "Volume", "Virtual"]
        rows = [
            [
                device.name,
                device.description,
                device.index if device.index is not None else "",
                device.sample_format,
                device.channels,
                device.sample_rate,
                device.mute,
                device.volume,
                device.virtual,
            ]
            for device in devices
        ]
        click.echo(tabulate(rows, headers=headers, tablefmt="plain"))


@output.command("create")
@click.argument("name")
@click.option("--persistent/--no-persistent", default=False, help="Make the device persistent")
@click.pass_obj
def output_create(obj: DeviceManager, name: str, persistent: bool) -> None:
    """Create a virtual output device."""
    pipe = obj.create_pipe(name, PipeType.OUTPUT, persistent=persistent)
    click.echo(f"Created output device '{pipe.name}' (persistent={pipe.persistent})", err=True)


@output.command("remove")
@click.argument("name")
@click.pass_obj
def output_remove(obj: DeviceManager, name: str) -> None:
    """Remove a virtual output device."""
    click.echo(f"Removing output device '{name}'", err=True)
    # TODO: Implement when DeviceManager has remove_output method


@output.command("play")
@click.argument("device_name")
@click.argument("audio_file", type=click.File("rb"))
@click.option("--raw/--no-raw", default=False, help="Treat audio as raw PCM data")
@click.pass_obj
def output_play(obj: DeviceManager, device_name: str, audio_file: typing.IO[bytes], raw: bool) -> None:
    """Play audio file to the specified output device."""
    devices = obj.list_outputs()
    device = next((d for d in devices if d.name == device_name), None)
    if not device:
        click.echo(f"Output device '{device_name}' not found", err=True)
        raise click.Abort()
    obj.play(device, audio_file, raw=raw)
    click.echo(f"Played audio to device '{device_name}'", err=True)
