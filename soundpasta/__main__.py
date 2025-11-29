import logging

import click

from soundpasta.device.cli import device

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


@click.group()
def cli() -> None:
    """Soundpasta - Transmit clipboard data over audio."""
    pass


cli.add_command(device)


if __name__ == "__main__":
    cli()
