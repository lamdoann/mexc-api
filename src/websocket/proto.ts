import protobuf from 'protobufjs';
import type { DecodedPushData } from '../types/websocket';

/**
 * Self-contained subset of MEXC's official websocket protobuf schema
 * (https://github.com/mexcdevelop/websocket-proto), trimmed to the trade/deals
 * channels we subscribe to. The wrapper's `oneof body` keeps the original field
 * numbers (publicDeals = 301, publicAggreDeals = 314) so the wire format matches;
 * any other channel's fields are simply ignored as unknown fields on decode.
 */
const PROTO_SCHEMA = `
syntax = "proto3";

message PublicDealsV3ApiItem {
  string price = 1;
  string quantity = 2;
  int32 tradeType = 3;
  int64 time = 4;
}

message PublicDealsV3Api {
  repeated PublicDealsV3ApiItem deals = 1;
  string eventType = 2;
}

message PublicAggreDealsV3ApiItem {
  string price = 1;
  string quantity = 2;
  int32 tradeType = 3;
  int64 time = 4;
}

message PublicAggreDealsV3Api {
  repeated PublicAggreDealsV3ApiItem deals = 1;
  string eventType = 2;
}

message PrivateOrdersV3Api {
  string id = 1;
  string clientId = 2;
  string price = 3;
  string quantity = 4;
  string amount = 5;
  string avgPrice = 6;
  int32 orderType = 7;
  int32 tradeType = 8;
  bool isMaker = 9;
  string remainAmount = 10;
  string remainQuantity = 11;
  optional string lastDealQuantity = 12;
  string cumulativeQuantity = 13;
  string cumulativeAmount = 14;
  int32 status = 15;
  int64 createTime = 16;
  optional string market = 17;
  optional int32 triggerType = 18;
  optional string triggerPrice = 19;
  optional int32 state = 20;
  optional string ocoId = 21;
  optional string routeFactor = 22;
  optional string symbolId = 23;
  optional string marketId = 24;
  optional string marketCurrencyId = 25;
  optional string currencyId = 26;
}

message PrivateDealsV3Api {
  string price = 1;
  string quantity = 2;
  string amount = 3;
  int32 tradeType = 4;
  bool isMaker = 5;
  bool isSelfTrade = 6;
  string tradeId = 7;
  string clientOrderId = 8;
  string orderId = 9;
  string feeAmount = 10;
  string feeCurrency = 11;
  int64 time = 12;
}

message PrivateAccountV3Api {
  string vcoinName = 1;
  string coinId = 2;
  string balanceAmount = 3;
  string balanceAmountChange = 4;
  string frozenAmount = 5;
  string frozenAmountChange = 6;
  string type = 7;
  int64 time = 8;
}

message PublicSpotKlineV3Api {
  string interval = 1;
  int64 windowStart = 2;
  string openingPrice = 3;
  string closingPrice = 4;
  string highestPrice = 5;
  string lowestPrice = 6;
  string volume = 7;
  string amount = 8;
  int64 windowEnd = 9;
}

message PushDataV3ApiWrapper {
  string channel = 1;
  oneof body {
    PublicDealsV3Api publicDeals = 301;
    PrivateOrdersV3Api privateOrders = 304;
    PrivateDealsV3Api privateDeals = 306;
    PrivateAccountV3Api privateAccount = 307;
    PublicSpotKlineV3Api publicSpotKline = 308;
    PublicAggreDealsV3Api publicAggreDeals = 314;
  }
  optional string symbol = 3;
  optional string symbolId = 4;
  optional int64 createTime = 5;
  optional int64 sendTime = 6;
}
`;

const root = protobuf.parse(PROTO_SCHEMA).root;
const PushDataV3ApiWrapper = root.lookupType('PushDataV3ApiWrapper');

/** Decode a binary websocket frame into a plain object. */
export function decodePushData(data: Uint8Array): DecodedPushData {
  const message = PushDataV3ApiWrapper.decode(data);
  return PushDataV3ApiWrapper.toObject(message, {
    longs: Number,
    enums: String,
    defaults: false,
  }) as DecodedPushData;
}
