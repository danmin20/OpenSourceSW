//라우터 : GET /, GET/join, GET /good, GET /list, GET /mygoodPOST /good, POST /change

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const schedule = require('node-schedule'); //낙찰자를 정하기 위한 스케줄링 모듈

const { Good, Auction, User, sequelize } = require('../models');
const { isLoggedIn, isNotLoggedIn } = require('./middlewares');

const router = express.Router();

router.use((req, res, next) => {
  res.locals.user = req.user; //모든 pug 템플릿에 사용자 정보를 변수로 집어넣음.
  next();                     //res.render 메서드에 user: req.user를 하지 않아도 되므로 중복 제거 가능
});

//메인 화면 렌더링, 렌더링할 때 경매 진행 중인 상품 목록 같이 불러옴
//낙찰자가 null이면 경매가 진행 중인 것
router.get('/', async (req, res, next) => {
  try {
    const goods = await Good.findAll({ where: { soldId: null } });
    res.render('main', {
      title: '중고로운 경희나라',
      goods,
      loginError: req.flash('loginError'),
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
});

//회원가입 화면 렌더링
router.get('/join', isNotLoggedIn, (req, res) => {
  res.render('join', {
    title: '회원가입 - NodeAuction',
    joinError: req.flash('joinError'),
  });
});

router.get('/change', isLoggedIn, (req, res) => {
  res.render('change', {
    title: '정보 수정',
    changeError: req.flash('changeError'),
  });
});

//상품 등록 화면 렌더링
router.get('/good', isLoggedIn, (req, res) => {
  res.render('good', { title: '상품 등록' });
});

fs.readdir('uploads', (error) => {
  if (error) {
    console.error('uploads 폴더가 없어 uploads 폴더를 생성합니다.');
    fs.mkdirSync('uploads');
  }
});
const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      cb(null, 'uploads/');
    },
    filename(req, file, cb) {
      const ext = path.extname(file.originalname);
      cb(null, path.basename(file.originalname, ext) + new Date().valueOf() + ext);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});

//업로드한 상품을 처리하는 라우터
//상품 이미지 업로드 기능이 있어 multer 미들웨어 붙음
//schedule 객체의 scheduleJob 메서드로 일정 예약
//첫 번째 인자 : 실행될 시각, 두 번째 인자 : 해당 시각이 되었을 때 수행할 콜백 함
router.post('/good', isLoggedIn, upload.single('img'), async (req, res, next) => {
  try {
    const { name, price } = req.body;
    const good = await Good.create({
      ownerId: req.user.id,
      name,
      img: req.file.filename,
      price,
    });
    const end = new Date();
    end.setDate(end.getDate() + 1); // 하루 뒤
    schedule.scheduleJob(end, async () => {
      const success = await Auction.find({
        where: { goodId: good.id },
        order: [['bid', 'DESC']],
      });
      await Good.update({ soldId: success.userId }, { where: { id: good.id } });
      await User.update({
        money: sequelize.literal(`money - ${success.bid}`),
      }, {
        where: { id: success.userId },
      });
    });
    res.redirect('/');
  } catch (error) {
    console.error(error);
    next(error);
  }
});

//해당 상품과 기존 입찰 정보들을 불러온 뒤 렌더링
router.get('/good/:id', isLoggedIn, async (req, res, next) => {
  try {
    const [good, auction] = await Promise.all([
      Good.find({
        where: { id: req.params.id },
        include: {
          model: User,
          as: 'owner', //일대다 관계가 두 번 연결(owner, sold)되어 있으므로 어떤 관계를 include할지 as 속성으로 밝혀줘야 함
        },
      }),
      Auction.findAll({
        where: { goodId: req.params.id },
        include: { model: User },
        order: [['bid', 'ASC']],
      }),
    ]);
    res.render('auction', {
      title: `${good.name}`,
      good,
      auction,
      auctionError: req.flash('auctionError'),
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
});

//클라이언트로부터 받은 입찰 정보 저장
router.post('/good/:id/bid', isLoggedIn, async (req, res, next) => {
  try {
    const { bid, msg } = req.body;
    const good = await Good.find({
      where: { id: req.params.id },
      include: { model: Auction },
      order: [[{ model: Auction }, 'bid', 'DESC']],
    });
    if (good.price > bid) { // 시작 가격보다 낮게 입찰하면
      return res.status(403).send('시작 가격보다 높게 입찰해야 합니다.');
    }
    // 경매 종료 시간이 지났으면
    if (new Date(good.createdAt).valueOf() + (24 * 60 * 60 * 1000) < new Date()) {
      return res.status(403).send('경매가 이미 종료되었습니다');
    }
    // 직전 입찰가와 현재 입찰가 비교
    if (good.auctions[0] && good.auctions[0].bid >= bid) {
      return res.status(403).send('이전 입찰가보다 높아야 합니다');
    }
    //정상적인 입찰가가 들어오면 저장 후 해당 경매방의 모든 사람에게 정보를 웹 소켓으로 전달
    const result = await Auction.create({
      bid,
      msg,
      userId: req.user.id,
      goodId: req.params.id,
    });
    req.app.get('io').to(req.params.id).emit('bid', {
      bid: result.bid,
      msg: result.msg,
      nick: req.user.nick,
    });
    return res.send('ok');
  } catch (error) {
    console.error(error);
    return next(error);
  }
});

//내 정보 수정
router.post('/change', isLoggedIn, async(req, res, next) => {
  const { email,nick, password, money } = req.body;
  try {
    const exNick = await User.find({where: {nick}});
    /*if(exNick){
      req.flash('changeError', '이미 존재하는 닉네임입니다.');
      return res.redirect('/change');
    }*/
    let toBeUpdated = {
      nick,
      money
    }
    if(password){
      const hashed=await bcrypt.hash(password,12)
      toBeUpdated['password']=hashed
    }
    await User.update(toBeUpdated,{
      where:{email}
    }).then(res=>{
      console.log(res)
    }).catch(error=>{
      console.error(error)
    })
    return res.redirect('/');
  } catch(error){
    console.error(error);
    return next(error);
  }
});

//낙찰자가 낙찰 내역을 볼 수 있도록 함
//낙찰된 상품과 그 상품의 입찰 내역을 조회한 후 렌더링
//입찰 내역 내림차순 정렬 - 낙찰자의 내역이 가장 위에 오도록
router.get('/list', isLoggedIn, async (req, res, next) => {
  try {
    const goods = await Good.findAll({
      where: { soldId: req.user.id },
      include: { model: Auction },
      order: [[{ model: Auction }, 'bid', 'DESC']],
    });
    res.render('list', { title: '낙찰 목록', goods });
  } catch (error) {
    console.error(error);
    next(error);
  }
});

//내 상품 목록
router.get('/mygood', isLoggedIn, async (req, res, next) => {
  try {
    const goods = await Good.findAll({
      where: { ownerId: req.user.id },
      order: ['createdAt'],
    });
    res.render('mygood', { title: '내 상품 목록', goods });
  } catch (error) {
    console.error(error);
    next(error);
  }
});

module.exports = router;
