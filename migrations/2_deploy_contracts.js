var Basic = artifacts.require("./Basic.sol");
var SkillRecords = artifacts.require("./SkillRecords.sol");

module.exports = function(deployer) {
  deployer.deploy(Basic);
  deployer.deploy(SkillRecords);
};
