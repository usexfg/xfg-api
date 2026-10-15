import os
import json
import requests

class BaseClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip('/')

    def _get(self, path: str):
        r = requests.get(self.base_url + path)
        r.raise_for_status()
        return r.json()

    def _post(self, path: str, body: dict | None = None):
        r = requests.post(self.base_url + path, json=body or {})
        r.raise_for_status()
        return r.json()

class NodeClient(BaseClient):
    def get_info(self):
        return self._get('/node/info')

    def get_height(self):
        return self._get('/node/height')

    def get_blockcount(self):
        return self._get('/node/blockcount')

    def get_last_block_header(self):
        return self._get('/node/last_block_header')

    def get_block_header_by_height(self, height: int):
        return self._get(f'/node/block_header_by_height/{height}')

    def get_public_audit_balances(self) -> dict:
        """Read-only accounting snapshot from a single chain tip.

        Monetary fields are decimal strings of atomic units, not ints: they
        exceed 2^53-1, so converting them to float loses digits. Use int() only
        when you need arithmetic, never float().
        """
        return self._get('/node/audit/balances')

class WalletClient(BaseClient):
    def get_balance(self):
        return self._get('/wallet/balance')

    def get_height(self):
        return self._get('/wallet/height')

    def get_transfers(self, filter: dict | None = None):
        return self._post('/wallet/transfers', filter)

    def transfer(self, req: dict):
        return self._post('/wallet/transfer', req)

    def optimize(self, req: dict | None = None):
        return self._post('/wallet/optimize', req)
