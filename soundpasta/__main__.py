import click

from soundpasta.device.cli import device


@click.group()
def cli() -> None:
    """Soundpasta - Transmit clipboard data over audio."""
    pass


cli.add_command(device)


if __name__ == "__main__":
    cli()
