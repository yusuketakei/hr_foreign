'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');

const app = express();
app.set('view engine', 'ejs');
app.use(express.static(__dirname + '/views'));
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json());
app.use(session({
    secret: 'hr test',
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge: 1000 * 60 * 60
    }
}));

const url = require('url');
const ejs = require('ejs');
const fs = require('fs');
const config = require('config');
console.log(config)
const logDir = config.log_dir ;

const TYPE_PROJECT = 0 ;
const TYPE_EDU = 1 ;
const TYPE_SKILL = 2 ;
const TYPE_QUALIFI = 3 ;

const STATUS_APPROVED = 0;
const STATUS_WATING_USER_APPROVE = 1;
const STATUS_WATING_BELONGS_APPROVE = 2;
const STATUS_INVALID = 9;


//geth rpc設定
const Web3 = require('web3');
var web3 = new Web3(new Web3.providers.HttpProvider(config.geth_url));

//IPFS API Client設定
const ipfsClient = require('ipfs-http-client');
var ipfs = ipfsClient({ host: 'localhost', port: '5001', protocol: 'http' }) ;

//from address
const fromAddress = config.from_address;
//gas
const gas = config.gas ;

//contract設定
var basicContract = new web3.eth.Contract(config.contract_basic_abi,config.contract_basic_address,{from:fromAddress});
var skillRecordsContract = new web3.eth.Contract(config.contract_skillRecords_abi,config.contract_skillRecords_address,{from:fromAddress});

//一覧処理のget処理
app.get('/', async (req, res) => {
    var userAddress = await getUserAddressParam(req) ;
    
    res.header('Content-Type', 'text/plain;charset=utf-8');
    //パラメータを設定してejsをレンダリング
    //ejsに渡す用のパラメータをセットしてく
    var ejsParams = {};

    ejsParams["userInfo"] = await getUserInfo(userAddress) ;

    //SkillRecordsから自分の保持するスキルを取得する(承認前のものも含めて取得)
    var skillRecordArray = await getMySkillRecords(userAddress) ;
    ejsParams["skillRecordArray"] = skillRecordArray ;
    ejsParams["skillRecordArray.length"] = skillRecordArray.length ;

    //express4でejsテンプレートを読み込むための呪文
    ejsParams["filename"] = "filename";
    //navbar用
    ejsParams["navActive"] = "/";
    //レンダリング
    fs.readFile('./views/index.ejs', 'utf-8', function (err, data) {
        renderEjsView(res, data, ejsParams);
    });
});

app.get('/registerSkill', async (req, res) => {
    var userAddress = await getUserAddressParam(req) ;

    //skill recordのtypeをクエリから取得
    var url_parts = url.parse(req.url, true);
    var recordType = url_parts.query.recordType ;
    
    res.header('Content-Type', 'text/plain;charset=utf-8');
    //パラメータを設定してejsをレンダリング
    //ejsに渡す用のパラメータをセットしてく
    var ejsParams = {};

    ejsParams["userInfo"] = await getUserInfo(userAddress) ;

    //express4でejsテンプレートを読み込むための呪文
    ejsParams["filename"] = "filename";
    //navbar用
    ejsParams["navActive"] = "/";
    //レンダリング recordTypeによって表示切替
    var distEjs ;
    if(recordType == TYPE_PROJECT){
        distEjs = "registerProject.ejs" ;
    }else if(recordType == TYPE_EDU){
        distEjs = "registerEdu.ejs" ;
    }else if(recordType == TYPE_SKILL){
        distEjs = "registerSkill.ejs" ;
    }else if(recordType == TYPE_QUALIFI){
        distEjs = "registerQualifi.ejs" ;
    }

    fs.readFile('./views/'+ distEjs, 'utf-8', function (err, data) {
        renderEjsView(res, data, ejsParams);
    });
});

app.post('/doRegisterProject', async (req, res) => {
    //セッションからuser addressを取得
    var userAddress = await getUserAddressParam(req) ;
    
    res.header('Content-Type', 'text/plain;charset=utf-8');

    //登録する情報の取得
    var skillRecordToIpfs = {} ;
    skillRecordToIpfs.company = req.body.company ;
    skillRecordToIpfs.startDate = formatDateYYYYMMDD(req.body.startDateYear,req.body.startDateMonth,req.body.startDateDay) ;
    skillRecordToIpfs.endDate = formatDateYYYYMMDD(req.body.endDateYear,req.body.endDateMonth,req.body.endDateDay) ;
    skillRecordToIpfs.job = req.body.job ;
    skillRecordToIpfs.position = req.body.position ;
    skillRecordToIpfs.userAddress = req.body.employeeAddress ;

    //IPFSにユーザー情報を書き込み
    var ipfsHash = await writeJsonToIpfs(JSON.stringify(skillRecordToIpfs)) ;
 
    //書き込んだHashをBasicInfoに登録
    await registerSkillRecordToContractByBelongs(skillRecordsContract,req.body.employeeAddress,ipfsHash,TYPE_PROJECT,userAddress) ;

    //ejsに渡す用のパラメータをセットしてく
    var ejsParams = {};
    ejsParams["userInfo"] = await getUserInfo(userAddress) ;
    //express4でejsテンプレートを読み込むための呪文
    ejsParams["filename"] = "filename";
    //navbar用
    ejsParams["navActive"] = "/registerProject";

    //リダイレクト
    // console.log(req.get('host'));
    // res.redirect(req.get('host')) ;
    //レンダリング
    fs.readFile('./views/registerProject.ejs', 'utf-8', function (err, data) {
        renderEjsView(res, data, ejsParams);
    });
});

//スキルの詳細情報を表示するとともに、自身が承認者の場合承認/否認を可能とする
app.get('/getSkillRecord', async (req, res) => {
    var userAddress = await getUserAddressParam(req) ;
    
    //skill recordのidをクエリから取得
    var url_parts = url.parse(req.url, true);
    var id = url_parts.query.id ;

    //詳細画面でのApprove実行用にSessionにskillRecordIdを持たせておく
    req.session.approveSkillRecordId = id ;

    res.header('Content-Type', 'text/plain;charset=utf-8');
    //パラメータを設定してejsをレンダリング
    //ejsに渡す用のパラメータをセットしてく
    var ejsParams = {};

    ejsParams["skillRecord"] = await getSkillRecordById(id) ;
    ejsParams["skillRecordKeys"] = Object.keys(ejsParams["skillRecord"]) ;

    //自分自身が承認者(Approver)かどうか確認、スタータスが未承認であればapproveが必要
    ejsParams["hasToApprove"] = hasToApprove(ejsParams["skillRecord"].status,await isWorkflowApprover(id,userAddress)) ;

    ejsParams["userInfo"] = await getUserInfo(userAddress) ;
    
    //express4でejsテンプレートを読み込むための呪文
    ejsParams["filename"] = "filename";
    //navbar用
    ejsParams["navActive"] = "/";
    //レンダリング
    fs.readFile('./views/skillRecordDetail.ejs', 'utf-8', function (err, data) {
        renderEjsView(res, data, ejsParams);
    });
});

app.post('/approveSkillRecord', async (req, res) => {
    //セッションからuser addressとapprove用のskillRecordIdを取得
    var userAddress = await getUserAddressParam(req) ;
    var approveSkillRecordId = req.session.approveSkillRecordId ;
    
    //approveボタンとdenyボタンのどちらが押されたか判別
    var isApproved ;
    if(req.body.hasOwnProperty('doApprove')){
        //approve
        isApproved = true ;
    }else{
        //deny
        isApproved = false ;
    }

    res.header('Content-Type', 'text/plain;charset=utf-8');

    //reqからcommentを取り出す
    var commentJson = {} ;
    commentJson.comment = req.body.comment ;

    //commentをIPFSに登録
    var ipfsHash = await writeJsonToIpfs(JSON.stringify(commentJson)) ;

    //skillRecordのapproveを実行
    await approveSkillRecord(skillRecordsContract,approveSkillRecordId,isApproved,userAddress,ipfsHash) ;

    //ejsに渡す用のパラメータをセットしてく
    var ejsParams = {};
    ejsParams["userInfo"] = await getUserInfo(userAddress) ;
    //express4でejsテンプレートを読み込むための呪文
    ejsParams["filename"] = "filename";
    //navbar用
    ejsParams["navActive"] = "/registerProject";
    //レンダリング
    fs.readFile('./views/skillRecordDetail.ejs', 'utf-8', function (err, data) {
        renderEjsView(res, data, ejsParams);
    });
});


app.get('/myInfo', async (req, res) => {
    var userAddress = await getUserAddressParam(req) ;
    
    res.header('Content-Type', 'text/plain;charset=utf-8');
    //パラメータを設定してejsをレンダリング
    //ejsに渡す用のパラメータをセットしてく
    var ejsParams = {};

    ejsParams["userInfo"] = await getUserInfo(userAddress) ;
    
    //express4でejsテンプレートを読み込むための呪文
    ejsParams["filename"] = "filename";
    //navbar用
    ejsParams["navActive"] = "/";
    //レンダリング
    fs.readFile('./views/myInfo.ejs', 'utf-8', function (err, data) {
        renderEjsView(res, data, ejsParams);
    });
});

app.get('/generateUser', async (req, res) => {
    //本来は秘密鍵の生成から
    var userAddress = await getUserAddressParam(req) ;
    
    res.header('Content-Type', 'text/plain;charset=utf-8');
    //パラメータを設定してejsをレンダリング
    //ejsに渡す用のパラメータをセットしてく
    var ejsParams = {};

    var userInfo = {}
    userInfo.userName = "未設定" ;
    
    ejsParams["userInfo"] = userInfo ;

    //express4でejsテンプレートを読み込むための呪文
    ejsParams["filename"] = "filename";
    //navbar用
    ejsParams["navActive"] = "/generateUser";
    //レンダリング
    fs.readFile('./views/generateUser.ejs', 'utf-8', function (err, data) {
        renderEjsView(res, data, ejsParams);
    });
});

app.post('/doGenerateUser', async (req, res) => {
    //セッションからuser addressを取得
    var userAddress = await getUserAddressParam(req) ;
    
    res.header('Content-Type', 'text/plain;charset=utf-8');

    //登録する情報の取得
    var basicInfoToIpfs = {} ;
    basicInfoToIpfs.firstName = req.body.firstName ;
    basicInfoToIpfs.lastName = req.body.lastName ;
    basicInfoToIpfs.country = req.body.country ;
    basicInfoToIpfs.realAddress = req.body.realAddress ;
    basicInfoToIpfs.userName = req.body.firstName + " " + req.body.lastName ;
    basicInfoToIpfs.userAddress = userAddress ;

    console.log("position1 " + (new Date()).toString()) ;

    //IPFSにユーザー情報を書き込み
    var ipfsHash = await writeJsonToIpfs(JSON.stringify(basicInfoToIpfs)) ;
    console.log("position2 " + (new Date()).toString()) ;
 
    //書き込んだHashをBasicInfoに登録
    await registerBasicInfoToContract(basicContract,userAddress,ipfsHash) ;

    console.log("position3 " + (new Date()).toString()) ;

    console.log(ipfsHash);
    //ejsに渡す用のパラメータをセットしてく
    var ejsParams = {};
    ejsParams["userInfo"] = basicInfoToIpfs ;
    //express4でejsテンプレートを読み込むための呪文
    ejsParams["filename"] = "filename";
    //navbar用
    ejsParams["navActive"] = "/generateUser";
    //レンダリング
    fs.readFile('./views/generateUser.ejs', 'utf-8', function (err, data) {
        renderEjsView(res, data, ejsParams);
    });
});


//userAddressを取得
async function getUserAddressParam(req){
    //demo用 user idからアドレスを取得する

    //getパラメータを取得
    var url_parts = url.parse(req.url, true);

    if (url_parts.query.userId){
        var userAddress = config.user_map[url_parts.query.userId];
        req.session.userAddress = userAddress ;        
    }
    //sessionからaccountを取得
    else if (req.session.userAddress) {
        var userAddress = req.session.userAddress;
    } 
    else {
        var userAddress = "";
    }
    return userAddress ;
}

//対象userAddressによるApproveが必要かどうか確認する
function hasToApprove(status,userAddress){
    if(status == STATUS_APPROVED){
        return false ;
    }else if(status == STATUS_INVALID){
        return false ;
    }else{
        return true ;
    }
}

//対象userAddressがApproverかどうか確認する
async function isWorkflowApprover(id,userAddress){
    var workflow = await getWorkflowFromContractById(skillRecordsContract,id) ;
    return workflow.approveAddress == userAddress ;
}

//SkillRecordから自分が持つスキルの一覧を取得する
async function getMySkillRecords(userAddress){
    //自分が持つSkill IDの一覧を取得
    var skillIdArray = await getMySkillRecordsFromContract(skillRecordsContract,userAddress) ;
    var skillRecordArray = { "array":[] } ;
    var promiseArray = []
    for(var i=0;i<skillIdArray.length;i++){
        promiseArray.push(
            putSkillRecordToArrayById(skillIdArray[i],skillRecordArray)
        );
    }
    await Promise.all(promiseArray) ;

    return skillRecordArray.array ;
}

async function putSkillRecordToArrayById(skillId,skillRecordArray){
    var skillRecord = await getSkillRecordById(skillId) ;
    //object.arrayの形でarrayを渡す
    skillRecordArray.array.push(skillRecord) ;
    return ;
}

//SkillRecordからHashを取得し、IPFSから情報を取得する
async function getSkillRecordById(id){
    //contractからSkillRecordを取得
    var contractSkillRecord = await getSkillRecordFromContractById(skillRecordsContract,id);

    //SkillRecordのipfs hashにあたるipfs contentsからjsonを抽出し、ユーザー情報として保持
    var skillRecord = await readJsonFromIpfs(contractSkillRecord.ipfsHash) ;
    skillRecord.id = id ;
    skillRecord.recordType = contractSkillRecord.recordType ;
    skillRecord.status = contractSkillRecord.status ;
    skillRecord.createdTimestamp = contractSkillRecord.createdTimestamp ;
    skillRecord.updatedTimestamp = contractSkillRecord.updatedTimestamp ;

    return skillRecord ;
}

//BasicContractからHashを取得し、IPFSからUserInfoを取得する
async function getUserInfo(userAddress){
    //contractからBasicInfoを取得
    var basicInfo = await getBasicInfoFromContract(basicContract,userAddress);

    //BasicInfoのipfs hashにあたるipfs contentsからjsonを抽出し、ユーザー情報として保持
    var userInfo = {}
    userInfo = await readJsonFromIpfs(basicInfo.ipfsHash) ;
    userInfo.userAddress = basicInfo.userAddress;
    return userInfo ;
}

//Contractから自分が持つSKillIdの一覧を取得する
async function getMySkillRecordsFromContract(contract,userAddress){
    return await contract.methods.getMySkillRecords().call({from:userAddress},function(err,result){
        if(err){
            console.log(err) ;
        }
        //コンバージョンする
        return result
    }) ;
}

//ContractからSkillRecordを取得する
async function getSkillRecordFromContractById(contract,id){
    var skillRecord = {}
    await contract.methods.getSkillRecord(id).call({},function(err,result){
        if(err){
            console.log(err) ;
        }
        //コンバージョンする
        skillRecord.userAddress = result[0] ;
        skillRecord.ipfsHash = result[1]
        skillRecord.recordType = parseInt(result[2],10);
        skillRecord.status = parseInt(result[3],10);
        skillRecord.createdTimestamp = parseInt(result[4],10);
        skillRecord.createdTimestamp = parseInt(result[5],10);
    }) ;
    return skillRecord ;
}

//ContractからSkillRecordのWorkflowを取得する
async function getWorkflowFromContractById(contract,id){
    var workflow = {}
    await contract.methods.getWorkFlow(id).call({},function(err,result){
        if(err){
            console.log(err) ;
        }
        //コンバージョンする
        workflow.generateAddress = result[0] ;
        workflow.approveAddress = result[1] ;
        workflow.commentIpfsHash = result[2] ;
        workflow.isApproved = result[3] ;
        workflow.generatedTimestamp = parseInt(result[4],10);
        workflow.approvedTimestamp = parseInt(result[5],10);
    }) ;

    return workflow ;
}

//ContractからbasicInfoを取得する
async function getBasicInfoFromContract(contract,userAddress){
    var basicInfo = {}
    await contract.methods.getUserInfo(userAddress).call({},function(err,result){
        if(err){
            console.log(err) ;
        }
        //コンバージョンする
        basicInfo.userAddress = result[0] ;
        basicInfo.ipfsHash = result[1]
        basicInfo.createdTimestamp = parseInt(result[2],10);
        basicInfo.createdTimestamp = parseInt(result[3],10);
    }) ;
    return basicInfo ;
}

//ContractにbasicInfoを登録する
async function registerBasicInfoToContract(contract,userAddress,ipfsHash){
    await contract.methods.createUser(ipfsHash).send({"from":userAddress,"gas":gas,"gasPrice":0});
}

//Contractにskill recordを登録する
async function registerSkillRecordToContractByBelongs(contract,userAddress,ipfsHash,recordType,senderAddress){
    await contract.methods.generateSkillRecordByBelongs(userAddress,ipfsHash,recordType)
    .send({"from":senderAddress,"gas":gas,"gasPrice":0});
}

//Contract上でSkillRecordをapproveする
async function approveSkillRecord(contract,skillRecordId,isApproved,userAddress,ipfsHash){
    await contract.methods.approve(skillRecordId,isApproved,ipfsHash)
    .send({"from":userAddress,"gas":gas,"gasPrice":0});
}

//IPFSへのJSONデータ出力(hashを返す)
async function writeJsonToIpfs(jsonData){
    var addContent = ipfs.types.Buffer.from(jsonData) ;
    var addResult = await ipfs.add([ {path: "", content: addContent} ]);
    return addResult[0].hash ;
}

async function readJsonFromIpfs(hash){
    //IPFS hashからJSONファイルを読み込む
    var data = await ipfs.cat(hash);
    return JSON.parse(data.toString()) ;
}

//日付format
function formatDateYYYYMMDD(yearStr,monthStr,dayStr){
    var yearPart = ('0000' + yearStr).slice(-4);
    var monthPart = ('00' + monthStr).slice(-2);
    var dayPart = ('00' + dayStr).slice(-2);
    return yearPart + monthPart + dayPart;
}

//ejs render
function renderEjsView(res, data, ejsParams) {
    var view = ejs.render(data, ejsParams);
    res.writeHead(200, {
        'Content-Type': 'text/html'
    });
    res.write(view);
    res.end();
}

//server side側のlogをファイルに出力
function loger(log){
    //debug用にconsole出力
    console.log(log) ;    
      
    //TODO ファイルパスの生成(とりあず今はファイル名固定)
    var filepath = logDir + "/server.log"
    
    fs.appendFile(filepath, log+"\n",{encoding: 'utf-8'} , function (err) {
          if(err){
              console.log(err);
          }
      });  
  }

if (module === require.main) {
    // [START server]
    // Start the server
    const server = app.listen(process.env.PORT || 8081, () => {
        const port = server.address().port;
        console.log(`App listening on port ${port}`);
    });
    // [END server]
}

module.exports = app;