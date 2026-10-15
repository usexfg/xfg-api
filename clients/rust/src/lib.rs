use reqwest::Client as HttpClient;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("url: {0}")]
    Url(#[from] url::ParseError),
}

#[derive(Clone)]
pub struct BaseClient {
    base: url::Url,
    http: HttpClient,
}

impl BaseClient {
    pub fn new(base_url: &str) -> Result<Self, Error> {
        let mut base = url::Url::parse(base_url)?;
        if !base.path().ends_with('/') {
            base.set_path(&format!("{}/", base.path()));
        }
        Ok(Self { base, http: HttpClient::new() })
    }

    async fn get_json<T: for<'de> Deserialize<'de>>(&self, path: &str) -> Result<T, Error> {
        let url = self.base.join(path)?;
        let res = self.http.get(url).send().await?.error_for_status()?;
        Ok(res.json::<T>().await?)
    }

    async fn post_json<B: Serialize + ?Sized, T: for<'de> Deserialize<'de>>(&self, path: &str, body: &B) -> Result<T, Error> {
        let url = self.base.join(path)?;
        let res = self.http.post(url).json(body).send().await?.error_for_status()?;
        Ok(res.json::<T>().await?)
    }
}

#[derive(Clone)]
pub struct NodeClient {
    base: BaseClient,
}

impl NodeClient {
    pub fn new(base_url: &str) -> Result<Self, Error> { Ok(Self { base: BaseClient::new(base_url)? }) }

    pub async fn health(&self) -> Result<serde_json::Value, Error> { self.base.get_json("health").await }
    pub async fn get_info(&self) -> Result<serde_json::Value, Error> { self.base.get_json("node/info").await }
    pub async fn get_height(&self) -> Result<serde_json::Value, Error> { self.base.get_json("node/height").await }
    pub async fn get_blockcount(&self) -> Result<serde_json::Value, Error> { self.base.get_json("node/blockcount").await }
    pub async fn get_last_block_header(&self) -> Result<serde_json::Value, Error> { self.base.get_json("node/last_block_header").await }
    pub async fn get_block_header_by_height(&self, height: u64) -> Result<serde_json::Value, Error> { self.base.get_json(&format!("node/block_header_by_height/{}", height)).await }

    /// Read-only accounting snapshot from a single chain tip.
    ///
    /// Monetary fields are decimal strings of atomic units. They exceed 2^53-1,
    /// so reading one as `f64` loses digits — deserialize them as `&str` or
    /// `u128`, never `f64`.
    pub async fn get_public_audit_balances(&self) -> Result<serde_json::Value, Error> { self.base.get_json("node/audit/balances").await }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Destination { pub address: String, pub amount: u64 }

#[derive(Clone)]
pub struct WalletClient { base: BaseClient }

impl WalletClient {
    pub fn new(base_url: &str) -> Result<Self, Error> { Ok(Self { base: BaseClient::new(base_url)? }) }

    pub async fn get_balance(&self) -> Result<serde_json::Value, Error> { self.base.get_json("wallet/balance").await }
    pub async fn get_height(&self) -> Result<serde_json::Value, Error> { self.base.get_json("wallet/height").await }
    pub async fn get_transfers(&self, filter: serde_json::Value) -> Result<serde_json::Value, Error> { self.base.post_json("wallet/transfers", &filter).await }

    pub async fn transfer(&self, destinations: Vec<Destination>, payment_id: Option<String>, mixin: Option<u64>, unlock_time: Option<u64>, messages: Option<serde_json::Value>, ttl: Option<u64>) -> Result<serde_json::Value, Error> {
        #[derive(Serialize)]
        struct Req<'a> {
            destinations: &'a [Destination],
            #[serde(skip_serializing_if = "Option::is_none")] payment_id: Option<String>,
            #[serde(skip_serializing_if = "Option::is_none")] mixin: Option<u64>,
            #[serde(skip_serializing_if = "Option::is_none")] unlock_time: Option<u64>,
            #[serde(skip_serializing_if = "Option::is_none")] messages: Option<serde_json::Value>,
            #[serde(skip_serializing_if = "Option::is_none")] ttl: Option<u64>,
        }
        let body = Req { destinations: &destinations, payment_id, mixin, unlock_time, messages, ttl };
        self.base.post_json("wallet/transfer", &body).await
    }

    pub async fn optimize(&self) -> Result<serde_json::Value, Error> { self.base.post_json::<_, serde_json::Value>("wallet/optimize", &serde_json::json!({})).await }
}
