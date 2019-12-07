//사용자가 입찰을 여러 번 할 수 있으므로 사용자 모델과 경매 모델은 일대다 관계
//한 상품에 여러 명이 입찰하므로 상품 모델과 경매 모델도 일대다 관계
//사용자 모델과 상품 모델 간에는 일대다 관계가 두 번 적용됨
//두 관계를 구별하기 위해 as 속성에 owner, sold으로 관계명 적어줌

const Sequelize = require('sequelize');

const env = process.env.NODE_ENV || 'development';
const config = require('../config/config')[env];
const db = {};

const sequelize = new Sequelize(
  config.database, config.username, config.password, config,
);

db.sequelize = sequelize;
db.Sequelize = Sequelize;
db.User = require('./user')(sequelize, Sequelize);
db.Good = require('./good')(sequelize, Sequelize);
db.Auction = require('./auction')(sequelize, Sequelize);

db.Good.belongsTo(db.User, { as: 'owner' });
db.Good.belongsTo(db.User, { as: 'sold' });
db.User.hasMany(db.Auction);
db.Good.hasMany(db.Auction);
db.Auction.belongsTo(db.User);
db.Auction.belongsTo(db.Good);

module.exports = db;
